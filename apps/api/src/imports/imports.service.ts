import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ReportType as DbReportType,
  ImportBatchStatus as DbBatchStatus,
  ImportRowStatus as DbRowStatus,
  FileFormat as DbFileFormat,
  IngestionSource as DbIngestionSource,
} from '@prisma/client';
import {
  AuditAction,
  ImportIssue,
  ImportIssueSeverity,
  IngestionSource,
  ReportType,
} from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FILE_STORAGE, FileStorage } from './storage';
import { sanitizeFilename } from './parsing/format';
import { buildAnalysis, parseFile, ParsedFile, processRow } from './parsing';
import { ConfirmImportDto } from './dto';

const toDbReport = (t: ReportType): DbReportType => DbReportType[t as keyof typeof DbReportType];
const toDbFormat = (t: string): DbFileFormat => DbFileFormat[t as keyof typeof DbFileFormat];

interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  private async resolveAccount(organizationId: string, marketplaceAccountId: string) {
    const acc = await this.prisma.marketplaceAccount.findFirst({
      where: { id: marketplaceAccountId, organizationId },
    });
    if (!acc) throw new NotFoundException('Loja não encontrada nesta organização.');
    return acc;
  }

  // ---------------------------------------------------------------------------
  // Fase 1 — análise (upload + detecção + prévia). Cria lote AWAITING_CONFIRMATION.
  // ---------------------------------------------------------------------------
  async analyze(
    organizationId: string,
    actorId: string,
    marketplaceAccountId: string,
    reportTypeOverride: ReportType | undefined,
    file: UploadedFile | undefined,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    const maxBytes = this.config.get<number>('MAX_UPLOAD_BYTES')!;
    if (file.size > maxBytes) {
      throw new BadRequestException(`Arquivo excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    }
    await this.resolveAccount(organizationId, marketplaceAccountId);

    const parsed = parseFile(file.buffer, file.originalname, reportTypeOverride);

    const alreadyImported =
      (await this.prisma.importBatch.count({
        where: {
          marketplaceAccountId,
          fileHash: parsed.fileHash,
          status: { in: [DbBatchStatus.COMPLETED, DbBatchStatus.COMPLETED_WITH_ERRORS] },
        },
      })) > 0;

    const analysis = buildAnalysis(parsed, alreadyImported);

    const storageKey = this.storage.buildKey(
      organizationId,
      marketplaceAccountId,
      parsed.fileHash,
      parsed.declaredExtension || parsed.format.toLowerCase(),
    );
    await this.storage.save(storageKey, file.buffer);

    const batch = await this.prisma.importBatch.create({
      data: {
        organizationId,
        marketplaceAccountId,
        ingestionSource: DbIngestionSource.MANUAL_UPLOAD,
        reportType: toDbReport(parsed.reportType),
        detectedReportType: toDbReport(parsed.detectedReportType),
        reportTypeConfidence: parsed.confidence,
        reportTypeManualOverride: parsed.manualOverride,
        originalFilename: file.originalname,
        sanitizedFilename: sanitizeFilename(file.originalname),
        declaredExtension: parsed.declaredExtension,
        fileFormat: toDbFormat(parsed.format),
        extensionMismatch: parsed.extensionMismatch,
        fileSizeBytes: parsed.fileSizeBytes,
        fileHash: parsed.fileHash,
        storageKey,
        sheetName: parsed.sheetName,
        headerRowIndex: parsed.headerRowIndex,
        dataStartRowIndex: parsed.dataStartRowIndex,
        columnCount: parsed.columns.length,
        physicalRowCount: parsed.physicalRowCount,
        dataRowCount: parsed.dataRows.length,
        periodStart: analysis.periodStart ? new Date(analysis.periodStart) : null,
        periodEnd: analysis.periodEnd ? new Date(analysis.periodEnd) : null,
        status: DbBatchStatus.AWAITING_CONFIRMATION,
        analysis: analysis as unknown as Prisma.InputJsonValue,
        createdByUserId: actorId,
      },
    });

    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.IMPORT_ANALYZE,
      entityType: 'ImportBatch',
      entityId: batch.id,
      metadata: {
        filename: file.originalname,
        reportType: parsed.reportType,
        confidence: parsed.confidence,
        headerRow: parsed.headerRowIndex,
      },
    });

    return { batch, analysis };
  }

  // ---------------------------------------------------------------------------
  // Fase 2 — confirmação (processamento efetivo).
  // ---------------------------------------------------------------------------
  async confirm(organizationId: string, actorId: string, batchId: string, dto: ConfirmImportDto) {
    const batch = await this.prisma.importBatch.findFirst({ where: { id: batchId, organizationId } });
    if (!batch) throw new NotFoundException('Lote de importação não encontrado.');
    if (batch.status !== DbBatchStatus.AWAITING_CONFIRMATION) {
      throw new BadRequestException('Este lote já foi processado. Use reprocessar se necessário.');
    }
    const effectiveType = (dto.reportType as ReportType | undefined) ?? (batch.reportType as unknown as ReportType);
    if (!effectiveType || effectiveType === ReportType.UNKNOWN) {
      throw new BadRequestException('Selecione o tipo de relatório antes de confirmar.');
    }
    return this.process(batch, effectiveType, dto.ingestionSource, actorId, false);
  }

  // ---------------------------------------------------------------------------
  // Reprocessamento controlado — re-executa o MESMO arquivo, de forma idempotente.
  // Remove as contribuições anteriores DESTE lote (linhas + chaves criadas por ele)
  // e reprocessa. Não duplica identidade financeira.
  // ---------------------------------------------------------------------------
  async reprocess(organizationId: string, actorId: string, batchId: string, dto: ConfirmImportDto) {
    const batch = await this.prisma.importBatch.findFirst({ where: { id: batchId, organizationId } });
    if (!batch) throw new NotFoundException('Lote de importação não encontrado.');
    const reprocessable: DbBatchStatus[] = [
      DbBatchStatus.COMPLETED,
      DbBatchStatus.COMPLETED_WITH_ERRORS,
      DbBatchStatus.FAILED,
    ];
    if (!reprocessable.includes(batch.status)) {
      throw new BadRequestException('Só é possível reprocessar lotes já processados.');
    }
    const effectiveType = (dto.reportType as ReportType | undefined) ?? (batch.reportType as unknown as ReportType);
    await this.prisma.$transaction([
      this.prisma.importRow.deleteMany({ where: { importBatchId: batch.id } }),
      this.prisma.importDedupKey.deleteMany({
        where: { marketplaceAccountId: batch.marketplaceAccountId, firstSeenBatchId: batch.id },
      }),
    ]);
    return this.process(batch, effectiveType, dto.ingestionSource, actorId, true);
  }

  // ---------------------------------------------------------------------------
  // Núcleo do processamento: normaliza, calcula hashes, deduplica e persiste.
  // ---------------------------------------------------------------------------
  private async process(
    batch: { id: string; organizationId: string; marketplaceAccountId: string; storageKey: string; originalFilename: string; analysis: unknown },
    effectiveType: ReportType,
    ingestionSource: IngestionSource | undefined,
    actorId: string,
    isReprocess: boolean,
  ) {
    const startedAt = new Date();
    const start = Date.now();
    const buffer = await this.storage.read(batch.storageKey);
    const parsed: ParsedFile = parseFile(buffer, batch.originalFilename, effectiveType);
    if (!parsed.spec || parsed.reportType === ReportType.UNKNOWN) {
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: DbBatchStatus.FAILED, errorMessage: 'Tipo de relatório não identificado.' },
      });
      throw new BadRequestException('Tipo de relatório não identificado.');
    }
    const dbReport = toDbReport(effectiveType);

    // Pré-carrega o livro de identidade da loja+relatório (dedup eficiente).
    const existing = await this.prisma.importDedupKey.findMany({
      where: { marketplaceAccountId: batch.marketplaceAccountId, reportType: dbReport },
      select: { canonicalHash: true, naturalKey: true },
    });
    const existingHash = new Set(existing.map((e) => e.canonicalHash));
    const existingNatural = new Set(existing.map((e) => e.naturalKey));
    const seenBatchHash = new Set<string>();
    const seenBatchNatural = new Set<string>();
    const hitHashes = new Set<string>();

    const rowsData: Prisma.ImportRowCreateManyInput[] = [];
    const ledgerData: Prisma.ImportDedupKeyCreateManyInput[] = [];

    let imported = 0;
    let updated = 0;
    let duplicated = 0;
    let warningRows = 0;
    let failed = 0;
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;

    for (const dr of parsed.dataRows) {
      const pr = processRow(parsed.spec, dr);
      const issues: ImportIssue[] = pr.normalized.issues;
      const errors = issues.filter((i) => i.severity === ImportIssueSeverity.ERROR);
      const warnings = issues.filter((i) => i.severity !== ImportIssueSeverity.ERROR);

      const d = pr.normalized.eventDate;
      if (d) {
        if (!periodStart || d < periodStart) periodStart = d;
        if (!periodEnd || d > periodEnd) periodEnd = d;
      }

      let status: DbRowStatus;
      if (errors.length > 0) {
        status = DbRowStatus.ERROR;
        failed++;
      } else {
        const isDup = existingHash.has(pr.canonicalHash) || seenBatchHash.has(pr.canonicalHash);
        if (isDup) {
          status = DbRowStatus.DUPLICATE;
          duplicated++;
          if (existingHash.has(pr.canonicalHash)) hitHashes.add(pr.canonicalHash);
        } else {
          seenBatchHash.add(pr.canonicalHash);
          const isUpdate =
            existingNatural.has(pr.normalized.naturalKey) || seenBatchNatural.has(pr.normalized.naturalKey);
          status = isUpdate ? DbRowStatus.UPDATED : DbRowStatus.IMPORTED;
          if (isUpdate) updated++;
          else imported++;
          seenBatchNatural.add(pr.normalized.naturalKey);
          ledgerData.push({
            marketplaceAccountId: batch.marketplaceAccountId,
            reportType: dbReport,
            canonicalHash: pr.canonicalHash,
            naturalKey: pr.normalized.naturalKey,
            firstSeenBatchId: batch.id,
            lastSeenBatchId: batch.id,
          });
        }
        if (warnings.length > 0) warningRows++;
      }

      rowsData.push({
        importBatchId: batch.id,
        sheetName: parsed.sheetName ?? 'default',
        physicalRowNumber: dr.physicalRowNumber,
        logicalRowNumber: dr.logicalRowNumber,
        rawPayload: pr.rawPayload as unknown as Prisma.InputJsonValue,
        normalizedPayload: pr.normalized.normalized as unknown as Prisma.InputJsonValue,
        detectedIdentifiers: pr.normalized.identifiers as unknown as Prisma.InputJsonValue,
        externalOrderId: pr.normalized.externalOrderId,
        externalReference: pr.normalized.externalReference,
        rawHash: pr.rawHash,
        canonicalHash: pr.canonicalHash,
        canonicalHashVersion: pr.canonicalHashVersion,
        processingStatus: status,
        warnings: warnings.length ? (warnings as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        errors: errors.length ? (errors as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      });
    }

    const totalRows = parsed.dataRows.length;
    const validRows = imported + updated + duplicated;
    const finalStatus = failed > 0 ? DbBatchStatus.COMPLETED_WITH_ERRORS : DbBatchStatus.COMPLETED;
    const processingMs = Date.now() - start;

    await this.prisma.$transaction(
      async (tx) => {
        if (rowsData.length) await tx.importRow.createMany({ data: rowsData });
        if (ledgerData.length) await tx.importDedupKey.createMany({ data: ledgerData, skipDuplicates: true });
        for (const h of hitHashes) {
          await tx.importDedupKey.updateMany({
            where: { marketplaceAccountId: batch.marketplaceAccountId, reportType: dbReport, canonicalHash: h },
            data: { lastSeenBatchId: batch.id, occurrences: { increment: 1 } },
          });
        }
        await tx.importBatch.update({
          where: { id: batch.id },
          data: {
            reportType: dbReport,
            reportTypeManualOverride: effectiveType !== (parsed.detectedReportType as ReportType),
            ingestionSource: ingestionSource ? DbIngestionSource[ingestionSource] : undefined,
            sheetName: parsed.sheetName,
            fileFormat: toDbFormat(parsed.format),
            extensionMismatch: parsed.extensionMismatch,
            headerRowIndex: parsed.headerRowIndex,
            dataStartRowIndex: parsed.dataStartRowIndex,
            columnCount: parsed.columns.length,
            physicalRowCount: parsed.physicalRowCount,
            dataRowCount: totalRows,
            periodStart,
            periodEnd,
            status: finalStatus,
            totalRows,
            validRows,
            importedRows: imported,
            updatedRows: updated,
            duplicatedRows: duplicated,
            warningRows,
            failedRows: failed,
            processingMs,
            errorMessage: null,
            startedAt,
            completedAt: new Date(),
          },
        });
      },
      { timeout: 60000 },
    );

    await this.audit.record({
      organizationId: batch.organizationId,
      userId: actorId,
      action: isReprocess ? AuditAction.IMPORT_REPROCESS : AuditAction.IMPORT_CONFIRM,
      entityType: 'ImportBatch',
      entityId: batch.id,
      metadata: {
        reportType: effectiveType,
        totalRows,
        importedRows: imported,
        updatedRows: updated,
        duplicatedRows: duplicated,
        warningRows,
        failedRows: failed,
        processingMs,
      },
    });

    return this.get(batch.organizationId, batch.id);
  }

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------
  list(organizationId: string, marketplaceAccountId?: string) {
    return this.prisma.importBatch.findMany({
      where: {
        organizationId,
        ...(marketplaceAccountId ? { marketplaceAccountId } : {}),
        status: { not: DbBatchStatus.DISCARDED },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        marketplaceAccount: { select: { displayName: true } },
        createdBy: { select: { name: true } },
      },
    });
  }

  async get(organizationId: string, id: string) {
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, organizationId },
      include: {
        marketplaceAccount: { select: { displayName: true } },
        createdBy: { select: { name: true, email: true } },
      },
    });
    if (!batch) throw new NotFoundException('Lote de importação não encontrado.');
    return batch;
  }

  async rows(
    organizationId: string,
    id: string,
    filter: { status?: string; issue?: string; page?: number },
  ) {
    const batch = await this.prisma.importBatch.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!batch) throw new NotFoundException('Lote de importação não encontrado.');
    const pageSize = 50;
    const page = Math.max(1, filter.page ?? 1);
    const where: Prisma.ImportRowWhereInput = { importBatchId: id };
    if (filter.status && filter.status in DbRowStatus) {
      where.processingStatus = filter.status as DbRowStatus;
    }
    if (filter.issue === 'warning') where.warnings = { not: Prisma.DbNull };
    if (filter.issue === 'error') where.errors = { not: Prisma.DbNull };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.importRow.count({ where }),
      this.prisma.importRow.findMany({
        where,
        orderBy: { physicalRowNumber: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async discard(organizationId: string, actorId: string, id: string) {
    const batch = await this.prisma.importBatch.findFirst({ where: { id, organizationId } });
    if (!batch) throw new NotFoundException('Lote de importação não encontrado.');
    if (batch.status !== DbBatchStatus.AWAITING_CONFIRMATION) {
      throw new BadRequestException('Só é possível descartar lotes ainda não confirmados.');
    }
    const updated = await this.prisma.importBatch.update({
      where: { id },
      data: { status: DbBatchStatus.DISCARDED },
    });
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.IMPORT_DISCARD,
      entityType: 'ImportBatch',
      entityId: id,
    });
    return updated;
  }
}
