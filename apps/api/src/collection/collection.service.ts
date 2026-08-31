import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  EntityStatus,
  Prisma,
  ScanCodeType,
  ScanResolutionResult,
} from '@financeiro/database';
import { AuthUser } from '@financeiro/shared';
import * as XLSX from 'xlsx';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOperationalLocationDto,
  CreateScanStationDto,
  ListShipmentScansDto,
  RegisterShipmentScanDto,
} from './dto';
import {
  looksLikeBrTracking,
  normalizeOperationalCode,
  normalizeScannedCode,
  spreadsheetSafe,
} from './collection.utils';

const EVENT_INCLUDE = {
  order: { select: { id: true, externalOrderId: true, trackingNumber: true, normalizedStatus: true } },
  marketplaceAccount: { select: { id: true, displayName: true, marketplace: true } },
  operator: { select: { id: true, name: true, email: true } },
  location: { select: { id: true, code: true, name: true, timezone: true } },
  station: { select: { id: true, code: true, name: true } },
} as const;

interface ScanCandidate {
  source: 'RELATIONAL' | 'WORKSPACE_V1';
  orderId: string | null;
  externalOrderId: string;
  trackingNumber: string | null;
  marketplaceAccountId: string | null;
  workspaceOperationId: string | null;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listLocations(organizationId: string) {
    return this.prisma.operationalLocation.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: { stations: { orderBy: [{ status: 'asc' }, { name: 'asc' }] } },
    });
  }

  async createLocation(user: AuthUser, dto: CreateOperationalLocationDto) {
    const row = await this.prisma.operationalLocation.create({
      data: {
        organizationId: user.organizationId,
        code: normalizeOperationalCode(dto.code),
        name: dto.name.trim(),
        timezone: dto.timezone?.trim() || 'America/Sao_Paulo',
      },
    });
    await this.recordAudit(user, 'collection.location.created', 'OperationalLocation', row.id, {
      code: row.code,
      name: row.name,
      timezone: row.timezone,
    });
    return row;
  }

  async createStation(user: AuthUser, locationId: string, dto: CreateScanStationDto) {
    const location = await this.prisma.operationalLocation.findFirst({
      where: { id: locationId, organizationId: user.organizationId },
    });
    if (!location) throw new BadRequestException('Local operacional inválido para esta organização.');
    const row = await this.prisma.scanStation.create({
      data: {
        organizationId: user.organizationId,
        locationId,
        code: normalizeOperationalCode(dto.code),
        name: dto.name.trim(),
        deviceIdentifier: dto.deviceIdentifier?.trim() || null,
      },
    });
    await this.recordAudit(user, 'collection.station.created', 'ScanStation', row.id, {
      locationId,
      code: row.code,
      name: row.name,
    });
    return row;
  }

  async registerScan(user: AuthUser, dto: RegisterShipmentScanDto) {
    const normalizedCode = normalizeScannedCode(dto.code);
    if (!normalizedCode) throw new BadRequestException('O código lido está vazio.');

    const replay = await this.prisma.shipmentScanEvent.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: user.organizationId,
          idempotencyKey: dto.idempotencyKey,
        },
      },
      include: EVENT_INCLUDE,
    });
    if (replay) return this.scanResponse(replay, true);

    let stored: any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        stored = await this.prisma.$transaction(
          async (tx) => {
            const idempotent = await tx.shipmentScanEvent.findUnique({
              where: {
                organizationId_idempotencyKey: {
                  organizationId: user.organizationId,
                  idempotencyKey: dto.idempotencyKey,
                },
              },
              include: EVENT_INCLUDE,
            });
            if (idempotent) return { event: idempotent, replay: true };

            const station = await tx.scanStation.findFirst({
              where: {
                id: dto.stationId,
                organizationId: user.organizationId,
                locationId: dto.locationId,
                status: EntityStatus.ACTIVE,
                location: { status: EntityStatus.ACTIVE },
              },
              select: { id: true },
            });
            if (!station) throw new BadRequestException('Local ou estação de bipagem inválidos/inativos.');

            const resolved = await this.resolveCandidates(
              tx,
              user.organizationId,
              dto,
              normalizedCode,
            );
            const candidates = resolved.candidates;
            const codeType = resolved.codeType;

            const matchedOrder = candidates.length === 1 ? candidates[0] : null;
            let result: ScanResolutionResult = candidates.length > 1
              ? ScanResolutionResult.AMBIGUOUS
              : matchedOrder
                ? ScanResolutionResult.MATCHED
                : ScanResolutionResult.NOT_FOUND;

            if (matchedOrder) {
              const confirmation = await tx.shipmentConfirmation.findUnique({
                where: { confirmationKey: this.confirmationKey(user.organizationId, matchedOrder) },
                select: { id: true },
              });
              if (confirmation) result = ScanResolutionResult.DUPLICATE;
            }

            const now = new Date();
            const event = await tx.shipmentScanEvent.create({
              data: {
                organizationId: user.organizationId,
                marketplaceAccountId: matchedOrder?.marketplaceAccountId ?? dto.marketplaceAccountId ?? null,
                orderId: matchedOrder?.orderId ?? null,
                userId: user.id,
                locationId: dto.locationId,
                stationId: dto.stationId,
                idempotencyKey: dto.idempotencyKey,
                rawCode: dto.code.trim(),
                normalizedCode,
                codeType,
                result,
                captureMethod: dto.captureMethod,
                resolvedExternalOrderId: matchedOrder?.externalOrderId ?? null,
                trackingNumberSnapshot: matchedOrder?.trackingNumber ?? null,
                workspaceOperationId: matchedOrder?.workspaceOperationId ?? dto.workspaceOperationId ?? null,
                orderSource: matchedOrder?.source ?? null,
                clientTimestamp: dto.clientTimestamp ? new Date(dto.clientTimestamp) : null,
                serverTimestamp: now,
                note: dto.note?.trim() || null,
                metadata: { candidateCount: candidates.length, orderSource: matchedOrder?.source ?? null },
              },
              include: EVENT_INCLUDE,
            });

            if (matchedOrder && result === ScanResolutionResult.MATCHED) {
              await tx.shipmentConfirmation.create({
                data: {
                  organizationId: user.organizationId,
                  marketplaceAccountId: matchedOrder.marketplaceAccountId,
                  orderId: matchedOrder.orderId,
                  workspaceOperationId: matchedOrder.workspaceOperationId,
                  externalOrderId: matchedOrder.externalOrderId,
                  confirmationKey: this.confirmationKey(user.organizationId, matchedOrder),
                  firstScanEventId: event.id,
                  userId: user.id,
                  locationId: dto.locationId,
                  stationId: dto.stationId,
                  confirmedAt: now,
                },
              });
            }
            return { event, replay: false };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error) {
        const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        if ((code === 'P2034' || code === 'P2002') && attempt < 2) continue;
        throw error;
      }
    }

    if (!stored) throw new BadRequestException('Não foi possível registrar a leitura. Tente novamente.');
    if (!stored.replay) {
      await this.recordAudit(user, `collection.scan.${String(stored.event.result).toLowerCase()}`, 'ShipmentScanEvent', stored.event.id, {
        result: stored.event.result,
        orderId: stored.event.orderId,
        externalOrderId: stored.event.resolvedExternalOrderId,
        stationId: stored.event.stationId,
        captureMethod: stored.event.captureMethod,
      }, stored.event.marketplaceAccountId);
    }
    return this.scanResponse(stored.event, stored.replay);
  }

  async listScans(organizationId: string, query: ListShipmentScansDto) {
    const page = boundedInt(query.page, 1, 1, 100_000);
    const pageSize = boundedInt(query.pageSize, 50, 1, 250);
    const where = this.scanWhere(organizationId, query);
    const [total, items] = await Promise.all([
      this.prisma.shipmentScanEvent.count({ where }),
      this.prisma.shipmentScanEvent.findMany({
        where,
        orderBy: { serverTimestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: EVENT_INCLUDE,
      }),
    ]);
    return { total, page, pageSize, items: items.map((event) => this.scanResponse(event, false)) };
  }

  async summary(organizationId: string, query: ListShipmentScansDto) {
    const where = this.scanWhere(organizationId, query);
    const rows = await this.prisma.shipmentScanEvent.findMany({
      where,
      select: { result: true, userId: true, orderId: true, resolvedExternalOrderId: true },
      take: 100_000,
    });
    const byResult = Object.values(ScanResolutionResult).reduce<Record<string, number>>((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {});
    rows.forEach((row) => { byResult[row.result] += 1; });
    return {
      total: rows.length,
      uniqueOrders: new Set(
        rows.map((row) => row.orderId ?? row.resolvedExternalOrderId).filter(Boolean),
      ).size,
      operators: new Set(rows.map((row) => row.userId)).size,
      byResult,
    };
  }

  async exportWorkbook(organizationId: string, query: ListShipmentScansDto): Promise<Buffer> {
    const rows = await this.prisma.shipmentScanEvent.findMany({
      where: this.scanWhere(organizationId, query),
      orderBy: { serverTimestamp: 'desc' },
      take: 100_000,
      include: EVENT_INCLUDE,
    });
    const counts = Object.values(ScanResolutionResult).map((result) => [
      result,
      rows.filter((row) => row.result === result).length,
    ]);
    const summary = XLSX.utils.aoa_to_sheet([
      ['RASTRO FINANCEIRO — RESUMO DA COLETA'],
      ['Gerado em', new Date().toISOString()],
      ['Total de leituras', rows.length],
      [
        'Pedidos únicos',
        new Set(rows.map((row) => row.orderId ?? row.resolvedExternalOrderId).filter(Boolean)).size,
      ],
      [],
      ['Resultado', 'Quantidade'],
      ...counts,
    ]);
    summary['!cols'] = [{ wch: 32 }, { wch: 22 }];

    const headers = ['Data', 'Hora', 'Local', 'Estação', 'Usuário', 'Código lido', 'Código normalizado', 'ID pedido Shopee', 'Conta', 'Método', 'Resultado', 'Observação'];
    const eventRows = rows.map((row) => {
      const local = new Date(row.serverTimestamp).toLocaleString('pt-BR', { timeZone: row.location.timezone });
      const [date, time] = local.split(',').map((part) => part.trim());
      return [
        date,
        time,
        row.location.name,
        row.station.name,
        row.operator.name,
        row.rawCode,
        row.normalizedCode,
        row.resolvedExternalOrderId ?? '',
        row.marketplaceAccount?.displayName ?? '',
        row.captureMethod,
        row.result,
        row.note ?? '',
      ].map(spreadsheetSafe);
    });
    const makeSheet = (selected: typeof eventRows) => {
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...selected]);
      sheet['!cols'] = [12, 11, 22, 22, 24, 24, 24, 25, 22, 16, 16, 36].map((wch) => ({ wch }));
      sheet['!autofilter'] = { ref: `A1:L${Math.max(1, selected.length + 1)}` };
      return sheet;
    };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, summary, 'Resumo');
    XLSX.utils.book_append_sheet(workbook, makeSheet(eventRows), 'Leituras');
    XLSX.utils.book_append_sheet(
      workbook,
      makeSheet(eventRows.filter((_, index) => rows[index].result === ScanResolutionResult.NOT_FOUND || rows[index].result === ScanResolutionResult.AMBIGUOUS)),
      'Pendências',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      makeSheet(eventRows.filter((_, index) => rows[index].result === ScanResolutionResult.DUPLICATE)),
      'Duplicidades',
    );
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
  }

  private scanWhere(organizationId: string, query: ListShipmentScansDto): Prisma.ShipmentScanEventWhereInput {
    const normalizedSearch = query.search ? normalizeScannedCode(query.search) : '';
    return {
      organizationId,
      ...(query.from || query.to ? {
        serverTimestamp: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...(query.marketplaceAccountId ? { marketplaceAccountId: query.marketplaceAccountId } : {}),
      ...(query.workspaceOperationId ? { workspaceOperationId: query.workspaceOperationId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.stationId ? { stationId: query.stationId } : {}),
      ...(normalizedSearch ? {
        OR: [
          { normalizedCode: { contains: normalizedSearch, mode: 'insensitive' } },
          { resolvedExternalOrderId: { contains: normalizedSearch, mode: 'insensitive' } },
          { order: { externalOrderId: { contains: normalizedSearch, mode: 'insensitive' } } },
          { order: { trackingNumber: { contains: normalizedSearch, mode: 'insensitive' } } },
        ],
      } : {}),
    };
  }

  private async resolveCandidates(
    tx: Prisma.TransactionClient,
    organizationId: string,
    dto: RegisterShipmentScanDto,
    normalizedCode: string,
  ): Promise<{ candidates: ScanCandidate[]; codeType: ScanCodeType }> {
    if (dto.marketplaceAccountId && dto.workspaceOperationId) {
      throw new BadRequestException('Informe uma conta de marketplace ou uma operação V1, não ambas.');
    }

    if (dto.workspaceOperationId) {
      const [operationsStore, ordersStore] = await Promise.all([
        tx.organizationWorkspaceStore.findUnique({
          where: { organizationId_storeName: { organizationId, storeName: 'operations' } },
          select: { payload: true },
        }),
        tx.organizationWorkspaceStore.findUnique({
          where: { organizationId_storeName: { organizationId, storeName: 'orders' } },
          select: { payload: true },
        }),
      ]);
      const operations = this.jsonRows(operationsStore?.payload);
      if (!operations.some((row) => String(row.id ?? '') === dto.workspaceOperationId)) {
        throw new BadRequestException('Operação V1 inválida para esta organização.');
      }
      const orders = this.jsonRows(ordersStore?.payload)
        .filter((row) => String(row.operationId ?? '') === dto.workspaceOperationId)
        .map<ScanCandidate>((row) => ({
          source: 'WORKSPACE_V1',
          orderId: null,
          externalOrderId: this.decodeWorkspaceOrderId(String(row.id ?? ''), dto.workspaceOperationId!),
          trackingNumber: row.tracking == null ? null : String(row.tracking),
          marketplaceAccountId: null,
          workspaceOperationId: dto.workspaceOperationId!,
        }));
      const direct = orders.filter((order) => normalizeScannedCode(order.externalOrderId) === normalizedCode).slice(0, 3);
      if (direct.length) return { candidates: direct, codeType: ScanCodeType.ORDER_ID };
      const byTracking = orders.filter((order) => normalizeScannedCode(order.trackingNumber ?? '') === normalizedCode).slice(0, 3);
      return {
        candidates: byTracking,
        codeType: byTracking.length || looksLikeBrTracking(normalizedCode) ? ScanCodeType.BR : ScanCodeType.UNKNOWN,
      };
    }

    if (dto.marketplaceAccountId) {
      const account = await tx.marketplaceAccount.findFirst({
        where: { id: dto.marketplaceAccountId, organizationId },
        select: { id: true },
      });
      if (!account) throw new BadRequestException('Conta de marketplace inválida.');
    }
    const scope: Prisma.MarketplaceOrderWhereInput = {
      organizationId,
      ...(dto.marketplaceAccountId ? { marketplaceAccountId: dto.marketplaceAccountId } : {}),
    };
    const mapOrder = (row: { id: string; externalOrderId: string; trackingNumber: string | null; marketplaceAccountId: string }): ScanCandidate => ({
      source: 'RELATIONAL',
      orderId: row.id,
      externalOrderId: row.externalOrderId,
      trackingNumber: row.trackingNumber,
      marketplaceAccountId: row.marketplaceAccountId,
      workspaceOperationId: null,
    });
    const select = { id: true, externalOrderId: true, trackingNumber: true, marketplaceAccountId: true } as const;
    const direct = (await tx.marketplaceOrder.findMany({
      where: { ...scope, externalOrderId: { equals: normalizedCode, mode: 'insensitive' } },
      select,
      take: 3,
    })).map(mapOrder);
    if (direct.length) return { candidates: direct, codeType: ScanCodeType.ORDER_ID };
    const byTracking = (await tx.marketplaceOrder.findMany({
      where: { ...scope, trackingNumber: { equals: normalizedCode, mode: 'insensitive' } },
      select,
      take: 3,
    })).map(mapOrder);
    return {
      candidates: byTracking,
      codeType: byTracking.length || looksLikeBrTracking(normalizedCode) ? ScanCodeType.BR : ScanCodeType.UNKNOWN,
    };
  }

  private jsonRows(payload: Prisma.JsonValue | undefined): Record<string, unknown>[] {
    if (!Array.isArray(payload)) return [];
    return payload
      .filter((row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
      .map((row) => row as unknown as Record<string, unknown>);
  }

  private decodeWorkspaceOrderId(storedId: string, operationId: string): string {
    const prefix = `${operationId}|`;
    return storedId.startsWith(prefix) ? storedId.slice(prefix.length) : storedId;
  }

  private confirmationKey(organizationId: string, candidate: ScanCandidate): string {
    return candidate.source === 'RELATIONAL'
      ? `RELATIONAL:${candidate.orderId}`
      : `WORKSPACE_V1:${organizationId}:${candidate.workspaceOperationId}:${candidate.externalOrderId}`;
  }

  private scanResponse(event: any, idempotentReplay: boolean) {
    const result = event.result as ScanResolutionResult;
    const orderId = event.resolvedExternalOrderId ?? event.order?.externalOrderId ?? null;
    const messages: Record<ScanResolutionResult, string> = {
      MATCHED: `Pedido ${orderId} localizado e saída confirmada.`,
      DUPLICATE: `Pedido ${orderId} já estava confirmado; a releitura foi auditada.`,
      NOT_FOUND: 'Código não localizado nos pedidos importados; leitura salva como pendente.',
      AMBIGUOUS: 'Código associado a mais de um pedido; leitura salva para resolução manual.',
    };
    return { ...event, idempotentReplay, message: messages[result] };
  }

  private async recordAudit(
    user: AuthUser,
    action: string,
    entityType: string,
    entityId: string,
    after: unknown,
    marketplaceAccountId?: string | null,
  ) {
    try {
      await this.audit.record({
        organizationId: user.organizationId,
        userId: user.id,
        userNameSnapshot: user.name,
        action,
        module: 'expedition',
        entityType,
        entityId,
        marketplaceAccountId: marketplaceAccountId ?? null,
        after,
      });
    } catch (error) {
      this.logger.warn(`Falha ao gravar auditoria paralela de ${action}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    }
  }
}
