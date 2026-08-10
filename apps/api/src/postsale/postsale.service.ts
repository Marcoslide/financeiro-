import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ImportBatchStatus as DbBatchStatus,
  OccurrenceType as DbOccurrenceType,
} from '@prisma/client';
import { AuditAction } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FILE_STORAGE, FileStorage } from '../imports/storage';
import { sanitizeFilename, detectFileFormat, declaredExtension } from '../imports/parsing/format';
import { fileHash as hashFile } from '../imports/parsing/hashing';
import { parsePostSale, PostSaleType, PostSaleRow } from './parsing/postsale-rows';
import { classifyExposure, EXPOSURE_METHODOLOGY } from './exposure';
import { putImportFinancialEvents, recomputeOccurrenceImpact } from './impact-store';

interface UploadedFile { originalname: string; buffer: Buffer; size: number }

const PARSER_VERSION = 'v1';
const TYPE_LABELS: Record<PostSaleType, string> = {
  RETURN_REFUND: 'Devoluções / Reembolsos',
  ORDER_CANCELLATION: 'Cancelamentos',
  FAILED_DELIVERY: 'Falhas de Entrega',
};

interface PeriodFilter { from?: Date; to?: Date }

@Injectable()
export class PostSaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  private async resolveAccount(organizationId: string, marketplaceAccountId: string) {
    const acc = await this.prisma.marketplaceAccount.findFirst({ where: { id: marketplaceAccountId, organizationId } });
    if (!acc) throw new NotFoundException('Loja não encontrada nesta organização.');
    return acc;
  }

  // ===========================================================================
  // Importação REAL (arquivo → parser Bloco 2 → Pedido/Ocorrência/Item)
  // ===========================================================================
  async importReport(
    organizationId: string,
    actorId: string,
    marketplaceAccountId: string,
    type: PostSaleType,
    file: UploadedFile | undefined,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    await this.resolveAccount(organizationId, marketplaceAccountId);
    const parsed = parsePostSale(file.buffer, file.originalname, type);
    if (parsed.notRecognized) {
      throw new BadRequestException(
        `Não foi possível reconhecer o relatório de ${TYPE_LABELS[type]}. Verifique se o arquivo corresponde ao tipo selecionado.`,
      );
    }

    const fileHash = hashFile(file.buffer);
    const format = detectFileFormat(file.buffer);
    const alreadyImported =
      (await this.prisma.postSaleImportBatch.count({
        where: { marketplaceAccountId, fileHash, status: { in: [DbBatchStatus.COMPLETED, DbBatchStatus.COMPLETED_WITH_ERRORS] } },
      })) > 0;

    const storageKey = this.storage.buildKey(
      organizationId,
      marketplaceAccountId,
      fileHash,
      declaredExtension(file.originalname) || format.toLowerCase(),
    );
    await this.storage.save(storageKey, file.buffer);

    const startedAt = new Date();
    const batch = await this.prisma.postSaleImportBatch.create({
      data: {
        organizationId,
        marketplaceAccountId,
        occurrenceType: type as DbOccurrenceType,
        originalFilename: file.originalname,
        sanitizedFilename: sanitizeFilename(file.originalname),
        fileFormat: format,
        fileSizeBytes: file.size,
        fileHash,
        storageKey,
        parserVersion: PARSER_VERSION,
        sheetName: parsed.sheetName,
        headerRowIndex: parsed.headerRowIndex,
        physicalRowCount: parsed.physicalRowCount,
        dataRowCount: parsed.dataRowCount,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        status: DbBatchStatus.PROCESSING,
        createdByUserId: actorId,
        startedAt,
      },
    });

    const start = Date.now();
    let r: Awaited<ReturnType<typeof this.materialize>>;
    try {
      r = await this.materialize(organizationId, marketplaceAccountId, type, batch.id, parsed.rows);
    } catch (e) {
      await this.prisma.postSaleImportBatch.update({
        where: { id: batch.id },
        data: { status: DbBatchStatus.FAILED, errorMessage: e instanceof Error ? e.message : 'Falha', completedAt: new Date(), processingMs: Date.now() - start },
      });
      throw e;
    }
    const status = r.errorRows > 0 ? DbBatchStatus.COMPLETED_WITH_ERRORS : DbBatchStatus.COMPLETED;
    await this.prisma.postSaleImportBatch.update({
      where: { id: batch.id },
      data: {
        status,
        totalRows: parsed.rows.length,
        occurrencesSeen: r.occurrencesSeen,
        itemsSeen: r.itemsSeen,
        newOccurrences: r.newOccurrences,
        updatedOccurrences: r.updatedOccurrences,
        unchangedOccurrences: r.unchangedOccurrences,
        ordersTouched: r.ordersTouched,
        unlinkedItems: r.unlinkedItems,
        errorRows: r.errorRows,
        errors: r.errors.length ? (r.errors as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        processingMs: Date.now() - start,
        completedAt: new Date(),
      },
    });

    await this.audit.record({
      organizationId, userId: actorId, action: AuditAction.POSTSALE_IMPORT,
      entityType: 'PostSaleImportBatch', entityId: batch.id,
      metadata: { type, ...r, errors: undefined },
    });

    return {
      batchId: batch.id, type, status, filename: file.originalname,
      periodStart: parsed.periodStart, periodEnd: parsed.periodEnd,
      totalRows: parsed.rows.length, alreadyImported, ...r,
    };
  }

  private async materialize(
    organizationId: string,
    marketplaceAccountId: string,
    type: PostSaleType,
    batchId: string,
    rows: PostSaleRow[],
  ) {
    const now = new Date();
    const errors: Array<{ physicalRow: number; message: string }> = [];
    // Agrupa por chave da ocorrência (multi-SKU: várias linhas → 1 ocorrência).
    const groups = new Map<string, PostSaleRow[]>();
    for (const row of rows) {
      if (!row.occurrenceKey || !row.orderId) {
        errors.push({ physicalRow: row.physicalRowNumber, message: 'Linha sem ID de pedido/ocorrência.' });
        continue;
      }
      const arr = groups.get(row.occurrenceKey) ?? [];
      arr.push(row);
      groups.set(row.occurrenceKey, arr);
    }

    // Pré-carrega vínculos de catálogo (SKU → variação) da loja.
    const allSkus = [...new Set(rows.map((r) => r.sku).filter(Boolean) as string[])];
    const variations = allSkus.length
      ? await this.prisma.productVariation.findMany({ where: { marketplaceAccountId, sku: { in: allSkus } }, select: { id: true, sku: true } })
      : [];
    const varBySku = new Map(variations.map((v) => [v.sku!, v.id]));

    let occurrencesSeen = 0, itemsSeen = 0, newOccurrences = 0, updatedOccurrences = 0, unchangedOccurrences = 0, unlinkedItems = 0;
    const orderIds = new Set<string>();

    for (const [key, group] of groups) {
      occurrencesSeen++;
      const rep = group.find((r) => r.status) ?? group[0]; // linha representativa
      const orderId = group.find((r) => r.orderId)!.orderId!;
      orderIds.add(orderId);

      const order = await this.prisma.marketplaceOrder.upsert({
        where: { marketplaceAccountId_externalOrderId: { marketplaceAccountId, externalOrderId: orderId } },
        create: {
          organizationId, marketplaceAccountId, externalOrderId: orderId,
          orderStatus: rep.orderStatus, orderCreatedAt: rep.orderCreatedAt, lastSeenAt: now,
        },
        update: { orderStatus: rep.orderStatus ?? undefined, lastSeenAt: now },
      });

      const occData = {
        status: rep.status, reason: rep.reason, resolution: rep.resolution, returnType: rep.returnType,
        disputeReason: rep.disputeReason, sellerNote: rep.sellerNote,
        requestedRefundAmount: rep.requestedRefundAmount, sellerCompensationAmount: rep.sellerCompensationAmount,
        buyerPaidAmount: rep.buyerPaidAmount, occurredAt: rep.occurredAt,
        trackingNumber: rep.trackingNumber, trackingStatus: rep.trackingStatus,
      };

      const existing = await this.prisma.postSaleOccurrence.findUnique({
        where: { marketplaceAccountId_type_naturalKey: { marketplaceAccountId, type: type as DbOccurrenceType, naturalKey: key } },
        select: { id: true, status: true },
      });

      let occId: string;
      if (!existing) {
        const created = await this.prisma.postSaleOccurrence.create({
          data: {
            organizationId, marketplaceAccountId, orderId: order.id, type: type as DbOccurrenceType,
            naturalKey: key, externalReturnId: rep.returnId, externalOrderId: orderId,
            sourceReportType: type, firstImportBatchId: batchId, lastImportBatchId: batchId,
            firstSeenAt: now, lastSeenAt: now, ...occData,
          },
        });
        occId = created.id;
        newOccurrences++;
      } else {
        occId = existing.id;
        if (existing.status && existing.status !== rep.status) {
          await this.prisma.occurrenceStatusHistory.create({
            data: { occurrenceId: occId, previousStatus: existing.status, newStatus: rep.status, importBatchId: batchId },
          });
          updatedOccurrences++;
        } else {
          unchangedOccurrences++;
        }
        await this.prisma.postSaleOccurrence.update({
          where: { id: occId }, data: { ...occData, lastImportBatchId: batchId, lastSeenAt: now },
        });
      }

      // Itens (nível SKU). itemKey estável → idempotente.
      let idx = 0;
      for (const row of group) {
        idx++;
        const itemKey = row.sku ? `sku:${row.sku}` : `pos:${idx}`;
        const variationId = row.sku ? varBySku.get(row.sku) ?? null : null;
        if (!variationId) unlinkedItems++;
        itemsSeen++;
        await this.prisma.postSaleOccurrenceItem.upsert({
          where: { occurrenceId_itemKey: { occurrenceId: occId, itemKey } },
          create: {
            occurrenceId: occId, organizationId, itemKey, sku: row.sku, parentSku: row.parentSku,
            productName: row.productName, variationName: row.variationName, quantity: row.quantity,
            unitPrice: row.unitPrice, productVariationId: variationId, skuLinked: !!variationId,
            rawPayload: row.rawPayload as unknown as Prisma.InputJsonValue,
          },
          update: {
            sku: row.sku, parentSku: row.parentSku, productName: row.productName, variationName: row.variationName,
            quantity: row.quantity, unitPrice: row.unitPrice, productVariationId: variationId, skuLinked: !!variationId,
            rawPayload: row.rawPayload as unknown as Prisma.InputJsonValue,
          },
        });
      }

      // Eventos financeiros idempotentes (compensação/reembolso confirmado) + impacto (§16/§17).
      await putImportFinancialEvents(
        this.prisma,
        { id: occId, organizationId, status: rep.status, requested: Number(rep.requestedRefundAmount ?? 0), compensation: Number(rep.sellerCompensationAmount ?? 0) },
        batchId,
      );
      await recomputeOccurrenceImpact(this.prisma, occId);
    }

    return { occurrencesSeen, itemsSeen, newOccurrences, updatedOccurrences, unchangedOccurrences, ordersTouched: orderIds.size, unlinkedItems, errorRows: errors.length, errors };
  }

  // ===========================================================================
  // Leituras
  // ===========================================================================
  private periodWhere(p: PeriodFilter): Prisma.PostSaleOccurrenceWhereInput {
    if (!p.from && !p.to) return {};
    const occurredAt: Prisma.DateTimeFilter = {};
    if (p.from) occurredAt.gte = p.from;
    if (p.to) occurredAt.lte = p.to;
    return { occurredAt };
  }

  async overview(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const base: Prisma.PostSaleOccurrenceWhereInput = { organizationId, marketplaceAccountId, ...this.periodWhere(p) };
    const [byType, occs, ordersWithOcc, unlinked] = await Promise.all([
      this.prisma.postSaleOccurrence.groupBy({ by: ['type'], where: base, _count: { _all: true } }),
      this.prisma.postSaleOccurrence.findMany({
        where: base,
        select: { status: true, requestedRefundAmount: true, sellerCompensationAmount: true },
      }),
      this.prisma.postSaleOccurrence.findMany({ where: base, select: { orderId: true }, distinct: ['orderId'] }),
      this.prisma.postSaleOccurrenceItem.count({ where: { organizationId, skuLinked: false, occurrence: base } }),
    ]);
    const exposure = this.sumExposure(occs);
    const typeCounts: Record<string, number> = {};
    byType.forEach((t) => { typeCounts[t.type] = t._count._all; });
    return {
      totalOccurrences: occs.length,
      distinctOrders: ordersWithOcc.length,
      byType: typeCounts,
      exposure,
      unlinkedItems: unlinked,
      methodology: EXPOSURE_METHODOLOGY,
    };
  }

  private sumExposure(occs: Array<{ status: string | null; requestedRefundAmount: Prisma.Decimal | null; sellerCompensationAmount: Prisma.Decimal | null }>) {
    const acc = { requested: 0, confirmedLoss: 0, atRisk: 0, recovered: 0, cancelled: 0, unclassified: 0, compensation: 0 };
    for (const o of occs) {
      const e = classifyExposure(o);
      acc.requested += e.requested;
      acc.compensation += e.compensation;
      acc.confirmedLoss += e.confirmedLoss;
      acc.atRisk += e.atRisk;
      if (e.bucket === 'RECOVERED') acc.recovered += e.compensation;
      if (e.bucket === 'CANCELLED') acc.cancelled += e.requested;
      if (e.bucket === 'UNCLASSIFIED') acc.unclassified += e.requested;
    }
    // arredonda
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      requested: round(acc.requested), confirmedLoss: round(acc.confirmedLoss), atRisk: round(acc.atRisk),
      recovered: round(acc.recovered), compensation: round(acc.compensation),
      cancelled: round(acc.cancelled), unclassified: round(acc.unclassified),
      potentiallyRecoverable: round(acc.atRisk), // em disputa/análise ainda pode ser revertido
    };
  }

  async exposure(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const occs = await this.prisma.postSaleOccurrence.findMany({
      where: { organizationId, marketplaceAccountId, ...this.periodWhere(p) },
      select: { status: true, requestedRefundAmount: true, sellerCompensationAmount: true },
    });
    return { ...this.sumExposure(occs), methodology: EXPOSURE_METHODOLOGY };
  }

  async listOccurrences(
    organizationId: string,
    marketplaceAccountId: string,
    p: PeriodFilter,
    filters: { type?: PostSaleType; status?: string; search?: string; linked?: 'linked' | 'unlinked'; page?: number; pageSize?: number },
  ) {
    const pageSize = [25, 50, 100].includes(filters.pageSize ?? 0) ? filters.pageSize! : 25;
    const page = Math.max(1, filters.page ?? 1);
    const where: Prisma.PostSaleOccurrenceWhereInput = { organizationId, marketplaceAccountId, ...this.periodWhere(p) };
    if (filters.type) where.type = filters.type as DbOccurrenceType;
    if (filters.status) where.status = { contains: filters.status, mode: 'insensitive' };
    if (filters.search) {
      const s = filters.search.trim();
      where.OR = [
        { externalOrderId: { contains: s } },
        { externalReturnId: { contains: s } },
        { items: { some: { sku: { contains: s, mode: 'insensitive' } } } },
        { items: { some: { productName: { contains: s, mode: 'insensitive' } } } },
      ];
    }
    if (filters.linked === 'unlinked') where.items = { some: { skuLinked: false } };
    if (filters.linked === 'linked') where.items = { some: { skuLinked: true } };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.postSaleOccurrence.count({ where }),
      this.prisma.postSaleOccurrence.findMany({
        where, orderBy: { occurredAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { items: { select: { sku: true, productName: true, variationName: true, quantity: true, skuLinked: true } }, _count: { select: { items: true } } },
      }),
    ]);
    const rows = items.map((o) => {
      const e = classifyExposure(o);
      return {
        id: o.id, type: o.type, externalOrderId: o.externalOrderId, externalReturnId: o.externalReturnId,
        status: o.status, reason: o.reason, resolution: o.resolution, occurredAt: o.occurredAt,
        itemCount: o._count.items, requestedRefundAmount: o.requestedRefundAmount, sellerCompensationAmount: o.sellerCompensationAmount,
        exposureBucket: e.bucket, items: o.items,
      };
    });
    return { total, page, pageSize, items: rows };
  }

  async getOccurrence(organizationId: string, id: string) {
    const o = await this.prisma.postSaleOccurrence.findFirst({
      where: { id, organizationId },
      include: {
        order: true,
        items: { include: { productVariation: { select: { id: true, sku: true, product: { select: { name: true } }, family: { select: { name: true } } } } } },
        statusHistory: { orderBy: { observedAt: 'asc' } },
      },
    });
    if (!o) throw new NotFoundException('Ocorrência não encontrada.');
    return { ...o, exposure: classifyExposure(o) };
  }

  /** Cobertura/saúde dos dados (§13/§74). */
  async coverage(organizationId: string, marketplaceAccountId: string) {
    const types: PostSaleType[] = ['RETURN_REFUND', 'ORDER_CANCELLATION', 'FAILED_DELIVERY'];
    const perType = await Promise.all(
      types.map(async (t) => {
        const agg = await this.prisma.postSaleOccurrence.aggregate({
          where: { organizationId, marketplaceAccountId, type: t as DbOccurrenceType },
          _count: { _all: true }, _min: { occurredAt: true }, _max: { occurredAt: true },
        });
        return { type: t, label: TYPE_LABELS[t], count: agg._count._all, periodStart: agg._min.occurredAt, periodEnd: agg._max.occurredAt };
      }),
    );
    const totalItems = await this.prisma.postSaleOccurrenceItem.count({ where: { organizationId, occurrence: { marketplaceAccountId } } });
    const linkedItems = await this.prisma.postSaleOccurrenceItem.count({ where: { organizationId, skuLinked: true, occurrence: { marketplaceAccountId } } });
    const withSku = await this.prisma.postSaleOccurrenceItem.count({ where: { organizationId, sku: { not: null }, occurrence: { marketplaceAccountId } } });
    return {
      perType,
      dataHealth: {
        totalItems,
        withSkuPct: totalItems ? Math.round((withSku / totalItems) * 100) : 0,
        linkedPct: totalItems ? Math.round((linkedItems / totalItems) * 100) : 0,
        unlinkedItems: totalItems - linkedItems,
      },
    };
  }

  /** Achados determinísticos (§34/§40) — concentração e ranking. Base para a IA. */
  async findings(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const where: Prisma.PostSaleOccurrenceWhereInput = { organizationId, marketplaceAccountId, ...this.periodWhere(p) };
    const occs = await this.prisma.postSaleOccurrence.findMany({
      where, select: { id: true, reason: true, requestedRefundAmount: true, sellerCompensationAmount: true, status: true, items: { select: { sku: true, productName: true } } },
    });
    // Ranking de SKUs por nº de ocorrências e por perda confirmada.
    const bySku = new Map<string, { sku: string; product: string | null; occ: number; loss: number }>();
    const byReason = new Map<string, number>();
    for (const o of occs) {
      const e = classifyExposure(o);
      if (o.reason) byReason.set(o.reason, (byReason.get(o.reason) ?? 0) + 1);
      const skus = new Set(o.items.map((i) => i.sku).filter(Boolean) as string[]);
      for (const sku of skus) {
        const cur = bySku.get(sku) ?? { sku, product: o.items.find((i) => i.sku === sku)?.productName ?? null, occ: 0, loss: 0 };
        cur.occ += 1; cur.loss += e.confirmedLoss / (skus.size || 1);
        bySku.set(sku, cur);
      }
    }
    const topSkus = [...bySku.values()].sort((a, b) => b.occ - a.occ).slice(0, 10);
    const topReasons = [...byReason.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    const totalOcc = occs.length;
    const findings: Array<{ type: string; title: string; description: string; confidence: string; evidence: unknown }> = [];
    if (topSkus.length && totalOcc > 0) {
      const top3 = topSkus.slice(0, 3);
      const share = top3.reduce((s, x) => s + x.occ, 0) / totalOcc;
      if (share >= 0.3) {
        findings.push({
          type: 'ATTENTION',
          title: `Concentração: ${top3.length} SKUs somam ${Math.round(share * 100)}% das ocorrências`,
          description: 'A maior parte das ocorrências está concentrada em poucos SKUs — priorizar investigação.',
          confidence: totalOcc >= 30 ? 'ALTA' : totalOcc >= 10 ? 'MEDIA' : 'BAIXA',
          evidence: top3,
        });
      }
    }
    return { topSkus, topReasons, findings, sampleSize: totalOcc };
  }

  listBatches(organizationId: string, marketplaceAccountId: string, type?: PostSaleType) {
    return this.prisma.postSaleImportBatch.findMany({
      where: { organizationId, marketplaceAccountId, ...(type ? { occurrenceType: type as DbOccurrenceType } : {}) },
      orderBy: { createdAt: 'desc' }, take: 100,
      include: { createdBy: { select: { name: true } } },
    });
  }
}
