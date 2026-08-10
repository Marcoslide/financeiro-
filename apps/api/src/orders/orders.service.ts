import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FILE_STORAGE, FileStorage } from '../imports/storage';
import { sanitizeFilename, detectFileFormat, declaredExtension } from '../imports/parsing/format';
import { parseOrders, OrderItemRow } from './parsing/orders-rows';
import { normalizeOrderStatus, NormalizedStatus, NORMALIZED_LABELS } from './status';
import { computeOrderFinance } from './finance';

interface UploadedFile { originalname: string; buffer: Buffer; size: number }
interface PeriodFilter { from?: Date; to?: Date }

const PARSER_VERSION = 'v1';
const num = (s: string | null | undefined): number => (s == null || s === '' ? 0 : Number(s));
const dstr = (s: string | null | undefined): string | null => (s == null || s === '' ? null : s);

/** Identidade estável do item dentro do pedido (§16). SKU normalizado + desempate por posição. */
function itemKeyFor(row: OrderItemRow, positionInOrder: number): string {
  const sku = (row.sku ?? '').trim();
  if (sku) return `sku:${sku.toLowerCase()}`;
  const variation = (row.variationName ?? '').trim().toLowerCase();
  if (variation) return `var:${variation}#${positionInOrder}`;
  return `pos:${positionInOrder}`;
}

@Injectable()
export class OrdersService {
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
  // Importação REAL (arquivo → parser Bloco 2 → Pedido/Item, upsert idempotente)
  // ===========================================================================
  async importReport(organizationId: string, actorId: string, marketplaceAccountId: string, file: UploadedFile | undefined) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    await this.resolveAccount(organizationId, marketplaceAccountId);
    const parsed = parseOrders(file.buffer, file.originalname);
    if (parsed.notRecognized) {
      throw new BadRequestException('Não foi possível reconhecer o relatório de Pedidos. Verifique se o arquivo é a exportação "Order.all…" da Shopee.');
    }
    const fileHash = parsed.fileHash;
    const format = detectFileFormat(file.buffer);
    const storageKey = this.storage.buildKey(organizationId, marketplaceAccountId, fileHash, declaredExtension(file.originalname) || format.toLowerCase());
    await this.storage.save(storageKey, file.buffer);

    const batch = await this.prisma.salesImportBatch.create({
      data: {
        organizationId, marketplaceAccountId,
        originalFilename: file.originalname, fileHash, parserVersion: PARSER_VERSION,
        periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, createdByUserId: actorId,
      },
    });

    const r = await this.materialize(organizationId, marketplaceAccountId, batch.id, parsed.rows);

    await this.prisma.salesImportBatch.update({
      where: { id: batch.id },
      data: {
        rowsProcessed: parsed.rows.length,
        ordersSeen: r.ordersSeen, newOrders: r.newOrders, updatedOrders: r.updatedOrders, unchangedOrders: r.unchangedOrders,
        itemsSeen: r.itemsSeen, newItems: r.newItems, updatedItems: r.updatedItems, unchangedItems: r.unchangedItems,
        errors: r.errors, warnings: r.warnings,
      },
    });
    await this.audit.record({
      organizationId, userId: actorId, action: AuditAction.ORDERS_IMPORT,
      entityType: 'SalesImportBatch', entityId: batch.id,
      metadata: { filename: file.originalname, ...r },
    });

    return {
      batchId: batch.id, filename: file.originalname, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd,
      rowsProcessed: parsed.rows.length, ...r,
    };
  }

  /**
   * Núcleo do UPSERT (§4-§9). Agrupa linhas por ID do pedido (§15), deduplica por
   * (conta + ID do pedido) e por itemKey, detecta alterações relevantes (§6/§12),
   * vincula SKU→Produto→Família→Custo com SNAPSHOT (§21-§23) e calcula resultado
   * estimado determinístico (§28).
   */
  private async materialize(organizationId: string, marketplaceAccountId: string, batchId: string, rows: OrderItemRow[]) {
    const now = new Date();
    let errors = 0, warnings = 0;
    const groups = new Map<string, OrderItemRow[]>();
    for (const row of rows) {
      if (!row.orderId) { errors++; continue; }
      const arr = groups.get(row.orderId) ?? [];
      arr.push(row);
      groups.set(row.orderId, arr);
    }

    // Pré-carrega vínculos de catálogo (SKU → variação + família + custo) — §21/§22.
    const allSkus = [...new Set(rows.map((r) => r.sku).filter(Boolean) as string[])];
    const variations = allSkus.length
      ? await this.prisma.productVariation.findMany({
          where: { marketplaceAccountId, sku: { in: allSkus } },
          select: { id: true, sku: true, familyId: true, family: { select: { id: true, currentCostAmount: true, currentCostEffectiveFrom: true, costUpdatedAt: true } } },
        })
      : [];
    const varBySku = new Map(variations.map((v) => [v.sku!, v]));

    let ordersSeen = 0, newOrders = 0, updatedOrders = 0, unchangedOrders = 0;
    let itemsSeen = 0, newItems = 0, updatedItems = 0, unchangedItems = 0;

    for (const [orderId, group] of groups) {
      ordersSeen++;
      const rep = group.find((r) => r.orderStatus) ?? group[0];
      const normalizedStatus = normalizeOrderStatus(rep.orderStatus);

      // Itens: monta identidade + snapshot de custo antes de gravar (para financeiro).
      const seenKeys = new Set<string>();
      const itemPlans = group.map((row, i) => {
        let key = itemKeyFor(row, i);
        while (seenKeys.has(key)) key = `${key}#${i}`; // garante unicidade em raríssimos duplicados exatos
        seenKeys.add(key);
        const v = row.sku ? varBySku.get(row.sku) : undefined;
        const linked = !!v;
        const familyCost = v?.family?.currentCostAmount != null ? Number(v.family.currentCostAmount) : null;
        const qty = row.quantity ?? 1;
        const subtotal = row.productSubtotal != null ? num(row.productSubtotal) : num(row.agreedPrice) * qty;
        const costUnit = familyCost;
        const costTotal = costUnit != null ? costUnit * qty : null;
        const costUnknown = !linked || costUnit == null;
        return {
          row, key, variationId: v?.id ?? null, linked, familyId: v?.family?.id ?? null,
          costUnit, costTotal, costUnknown, costMissing: linked && costUnit == null,
          costReferenceAt: v?.family?.currentCostEffectiveFrom ?? v?.family?.costUpdatedAt ?? null,
          qty, subtotal,
        };
      });

      const fin = computeOrderFinance({
        commissionNet: num(rep.commissionNet), serviceFeeNet: num(rep.serviceFeeNet),
        transactionFee: num(rep.transactionFee), reverseShippingFee: num(rep.reverseShippingFee),
        items: itemPlans.map((p) => ({ subtotal: p.subtotal, costTotal: p.costTotal, costUnknown: p.costUnknown })),
      });

      const orderData = {
        orderStatus: rep.orderStatus, normalizedStatus,
        cancelReason: rep.cancelReason, returnRefundStatus: rep.returnRefundStatus,
        trackingNumber: rep.trackingNumber, shippingOption: rep.shippingOption, shippingMethod: rep.shippingMethod,
        orderCreatedAt: rep.orderCreatedAt, paidAt: rep.paidAt, shipByDate: rep.shipByDate,
        shippedAt: rep.shippedAt, deliveredAt: rep.deliveredAt, completedAt: rep.completedAt, cancelledAt: rep.cancelledAt,
        // Financeiro do pedido — persistido UMA vez (§17).
        itemsSubtotal: dstr(String(fin.revenue)), totalAmount: dstr(rep.totalAmount), grandTotal: dstr(rep.grandTotal),
        buyerPaidShipping: dstr(rep.buyerPaidShipping), reverseShippingFee: dstr(rep.reverseShippingFee),
        transactionFee: dstr(rep.transactionFee), commissionGross: dstr(rep.commissionGross), commissionNet: dstr(rep.commissionNet),
        serviceFeeGross: dstr(rep.serviceFeeGross), serviceFeeNet: dstr(rep.serviceFeeNet),
        estimatedShipping: dstr(rep.estimatedShipping), sellerDiscountTotal: null as string | null,
        marketplaceFeesTotal: String(fin.marketplaceFeesTotal),
        productCostTotal: String(fin.productCostTotal),
        estimatedResult: fin.estimatedResult == null ? null : String(fin.estimatedResult),
        estimatedMarginPct: fin.estimatedMarginPct == null ? null : String(fin.estimatedMarginPct),
        costPending: fin.costPending,
        unitsTotal: rep.unitsTotal ?? itemPlans.reduce((s, p) => s + p.qty, 0),
        itemCount: itemPlans.length,
        buyerUsername: rep.buyerUsername, recipientName: rep.recipientName, phone: rep.phone,
        address: rep.address, city: rep.city, district: rep.district, uf: rep.uf, country: rep.country,
        cep: rep.cep, buyerNote: rep.buyerNote, note: rep.note,
        rawPayload: rep.rawPayload as unknown as Prisma.InputJsonValue,
      };

      const existing = await this.prisma.marketplaceOrder.findUnique({
        where: { marketplaceAccountId_externalOrderId: { marketplaceAccountId, externalOrderId: orderId } },
        select: { id: true, orderStatus: true, normalizedStatus: true, trackingNumber: true, returnRefundStatus: true, totalAmount: true, grandTotal: true },
      });

      let orderPk: string;
      let orderChanged = false;
      if (!existing) {
        const created = await this.prisma.marketplaceOrder.create({
          data: {
            organizationId, marketplaceAccountId, externalOrderId: orderId,
            firstImportBatchId: batchId, lastImportBatchId: batchId, firstSeenAt: now, lastSeenAt: now, ...orderData,
          },
          select: { id: true },
        });
        orderPk = created.id;
        newOrders++;
      } else {
        orderPk = existing.id;
        // Detecção de alteração relevante (§5/§6).
        const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
        if ((existing.orderStatus ?? null) !== (rep.orderStatus ?? null)) changes.push({ field: 'status', oldValue: existing.orderStatus, newValue: rep.orderStatus });
        if ((existing.trackingNumber ?? null) !== (rep.trackingNumber ?? null)) changes.push({ field: 'trackingNumber', oldValue: existing.trackingNumber, newValue: rep.trackingNumber });
        if ((existing.returnRefundStatus ?? null) !== (rep.returnRefundStatus ?? null)) changes.push({ field: 'returnRefundStatus', oldValue: existing.returnRefundStatus, newValue: rep.returnRefundStatus });
        const eq = (a: Prisma.Decimal | null, b: string | null) => (a == null ? null : String(Number(a))) === (b == null ? null : String(Number(b)));
        if (!eq(existing.totalAmount, rep.totalAmount)) changes.push({ field: 'totalAmount', oldValue: existing.totalAmount?.toString() ?? null, newValue: rep.totalAmount });
        if (!eq(existing.grandTotal, rep.grandTotal)) changes.push({ field: 'grandTotal', oldValue: existing.grandTotal?.toString() ?? null, newValue: rep.grandTotal });

        orderChanged = changes.length > 0;
        if (orderChanged) {
          updatedOrders++;
          for (const c of changes) {
            await this.prisma.orderStatusHistory.create({ data: { orderId: orderPk, field: c.field, oldValue: c.oldValue, newValue: c.newValue, importBatchId: batchId } });
          }
        } else {
          unchangedOrders++;
        }
        // Datas históricas nunca são sobrescritas (§5/§11): mantém orderCreatedAt/firstSeenAt.
        const { orderCreatedAt: _ignore, ...mutable } = orderData;
        await this.prisma.marketplaceOrder.update({
          where: { id: orderPk },
          data: { ...mutable, lastImportBatchId: batchId, lastSeenAt: now },
        });
      }

      // Itens: upsert por itemKey (§16). Conta novos/atualizados/sem alteração.
      for (const p of itemPlans) {
        itemsSeen++;
        const itemData = {
          organizationId, itemKey: p.key, lineIndex: p.row.lineIndex,
          productName: p.row.productName, sku: p.row.sku, mainSkuRef: p.row.mainSkuRef, variationName: p.row.variationName,
          originalPrice: dstr(p.row.originalPrice), agreedPrice: dstr(p.row.agreedPrice), quantity: p.qty,
          productSubtotal: String(p.subtotal), sellerDiscount1: dstr(p.row.sellerDiscount1), sellerDiscount2: dstr(p.row.sellerDiscount2),
          weightSku: dstr(p.row.weightSku),
          productVariationId: p.variationId, skuLinked: p.linked,
          costUnit: p.costUnit == null ? null : String(p.costUnit), costTotal: p.costTotal == null ? null : String(p.costTotal),
          costSource: p.linked ? (p.costUnit == null ? 'NONE' : 'FAMILY') : 'NONE',
          costFamilyId: p.familyId, costReferenceAt: p.costReferenceAt, costMissing: p.costMissing,
          allocatedFees: String(fin.items[itemPlans.indexOf(p)].allocatedFees),
          estimatedResult: fin.items[itemPlans.indexOf(p)].estimatedResult == null ? null : String(fin.items[itemPlans.indexOf(p)].estimatedResult),
          estimatedMarginPct: fin.items[itemPlans.indexOf(p)].estimatedMarginPct == null ? null : String(fin.items[itemPlans.indexOf(p)].estimatedMarginPct),
          rawPayload: p.row.rawPayload as unknown as Prisma.InputJsonValue,
        };
        const existingItem = await this.prisma.marketplaceOrderItem.findUnique({
          where: { orderId_itemKey: { orderId: orderPk, itemKey: p.key } }, select: { id: true, agreedPrice: true, quantity: true, skuLinked: true },
        });
        if (!existingItem) {
          await this.prisma.marketplaceOrderItem.create({ data: { orderId: orderPk, ...itemData } });
          newItems++;
        } else {
          const changed =
            (existingItem.agreedPrice == null ? null : Number(existingItem.agreedPrice)) !== num(p.row.agreedPrice) ||
            existingItem.quantity !== p.qty || existingItem.skuLinked !== p.linked;
          await this.prisma.marketplaceOrderItem.update({ where: { id: existingItem.id }, data: itemData });
          if (changed) updatedItems++; else unchangedItems++;
        }
      }
    }

    return { ordersSeen, newOrders, updatedOrders, unchangedOrders, itemsSeen, newItems, updatedItems, unchangedItems, errors, warnings };
  }

  // ===========================================================================
  // Leituras
  // ===========================================================================
  private periodWhere(p: PeriodFilter): Prisma.MarketplaceOrderWhereInput {
    if (!p.from && !p.to) return {};
    const orderCreatedAt: Prisma.DateTimeNullableFilter = {};
    if (p.from) orderCreatedAt.gte = p.from;
    if (p.to) orderCreatedAt.lte = p.to;
    return { orderCreatedAt };
  }

  async listOrders(
    organizationId: string,
    marketplaceAccountId: string,
    p: PeriodFilter,
    f: { tab?: string; search?: string; status?: string; linked?: 'linked' | 'unlinked'; costPending?: boolean; sort?: string; page?: number; pageSize?: number },
  ) {
    const pageSize = [25, 50, 100].includes(f.pageSize ?? 0) ? f.pageSize! : 25;
    const page = Math.max(1, f.page ?? 1);
    const where: Prisma.MarketplaceOrderWhereInput = { organizationId, marketplaceAccountId, ...this.periodWhere(p) };
    if (f.tab && f.tab !== 'ALL') where.normalizedStatus = f.tab;
    if (f.status) where.normalizedStatus = f.status;
    if (f.costPending) where.costPending = true;
    if (f.linked === 'unlinked') where.items = { some: { skuLinked: false } };
    if (f.linked === 'linked') where.items = { some: { skuLinked: true } };
    if (f.search) {
      const s = f.search.trim();
      where.OR = [
        { externalOrderId: { contains: s, mode: 'insensitive' } },
        { trackingNumber: { contains: s, mode: 'insensitive' } },
        { items: { some: { sku: { contains: s, mode: 'insensitive' } } } },
        { items: { some: { productName: { contains: s, mode: 'insensitive' } } } },
        { items: { some: { variationName: { contains: s, mode: 'insensitive' } } } },
      ];
    }
    const orderBy = this.sortOrder(f.sort);
    const [total, orders] = await this.prisma.$transaction([
      this.prisma.marketplaceOrder.count({ where }),
      this.prisma.marketplaceOrder.findMany({
        where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
        include: {
          items: { select: { sku: true, productName: true, variationName: true, quantity: true, skuLinked: true } },
          _count: { select: { items: true, occurrences: true } },
        },
      }),
    ]);
    const rows = orders.map((o) => ({
      id: o.id, externalOrderId: o.externalOrderId, orderStatus: o.orderStatus,
      normalizedStatus: o.normalizedStatus, normalizedLabel: NORMALIZED_LABELS[(o.normalizedStatus as NormalizedStatus) ?? 'OUTRO'],
      orderCreatedAt: o.orderCreatedAt, trackingNumber: o.trackingNumber,
      itemCount: o._count.items, hasReturn: o._count.occurrences > 0,
      totalAmount: o.totalAmount, itemsSubtotal: o.itemsSubtotal, marketplaceFeesTotal: o.marketplaceFeesTotal,
      productCostTotal: o.productCostTotal, estimatedResult: o.estimatedResult, estimatedMarginPct: o.estimatedMarginPct,
      costPending: o.costPending,
      items: o.items,
    }));
    return { total, page, pageSize, items: rows };
  }

  private sortOrder(sort?: string): Prisma.MarketplaceOrderOrderByWithRelationInput {
    switch (sort) {
      case 'oldest': return { orderCreatedAt: 'asc' };
      case 'sale_desc': return { totalAmount: 'desc' };
      case 'sale_asc': return { totalAmount: 'asc' };
      case 'profit_desc': return { estimatedResult: 'desc' };
      case 'profit_asc': return { estimatedResult: 'asc' };
      default: return { orderCreatedAt: 'desc' };
    }
  }

  async getOrder(organizationId: string, id: string) {
    const o = await this.prisma.marketplaceOrder.findFirst({
      where: { id, organizationId },
      include: {
        items: { include: { productVariation: { select: { id: true, sku: true, product: { select: { name: true } }, family: { select: { id: true, name: true, currentCostAmount: true } } } } }, orderBy: { lineIndex: 'asc' } },
        statusHistory: { orderBy: { observedAt: 'desc' }, take: 100 },
        occurrences: { select: { id: true, type: true, status: true, requestedRefundAmount: true, occurredAt: true } },
      },
    });
    if (!o) throw new NotFoundException('Pedido não encontrado.');
    return { ...o, normalizedLabel: NORMALIZED_LABELS[(o.normalizedStatus as NormalizedStatus) ?? 'OUTRO'] };
  }

  /** Dashboard (§38) — indicadores agregados do período. */
  async dashboard(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const base: Prisma.MarketplaceOrderWhereInput = { organizationId, marketplaceAccountId, ...this.periodWhere(p) };
    const [agg, byStatus, unlinked, costPending, withReturns, units] = await Promise.all([
      this.prisma.marketplaceOrder.aggregate({
        where: base,
        _count: { _all: true },
        _sum: { itemsSubtotal: true, totalAmount: true, marketplaceFeesTotal: true, productCostTotal: true, estimatedResult: true, unitsTotal: true },
      }),
      this.prisma.marketplaceOrder.groupBy({ by: ['normalizedStatus'], where: base, _count: { _all: true } }),
      this.prisma.marketplaceOrder.count({ where: { ...base, items: { some: { skuLinked: false } } } }),
      this.prisma.marketplaceOrder.count({ where: { ...base, costPending: true } }),
      this.prisma.marketplaceOrder.count({ where: { ...base, occurrences: { some: {} } } }),
      this.prisma.marketplaceOrderItem.aggregate({ where: { order: base }, _sum: { quantity: true } }),
    ]);
    const statusCounts: Record<string, number> = {};
    byStatus.forEach((s) => { statusCounts[s.normalizedStatus ?? 'OUTRO'] = s._count._all; });
    const revenue = Number(agg._sum.itemsSubtotal ?? 0);
    const result = Number(agg._sum.estimatedResult ?? 0);
    const orders = agg._count._all;
    return {
      orders,
      unitsSold: Number(units._sum.quantity ?? 0),
      revenue,
      totalAmount: Number(agg._sum.totalAmount ?? 0),
      marketplaceFees: Number(agg._sum.marketplaceFeesTotal ?? 0),
      productCost: Number(agg._sum.productCostTotal ?? 0),
      estimatedResult: result,
      estimatedMarginPct: revenue ? Math.round((result / revenue) * 10000) / 100 : 0,
      averageTicket: orders ? Math.round((revenue / orders) * 100) / 100 : 0,
      statusCounts,
      cancellations: statusCounts['CANCELADO'] ?? 0,
      returns: withReturns,
      skusUnlinkedOrders: unlinked,
      costPendingOrders: costPending,
    };
  }

  /** Análise por dimensão (§39) — produto/sku/família/estado/status. Determinístico. */
  async analytics(organizationId: string, marketplaceAccountId: string, p: PeriodFilter, dimension: string) {
    const orderWhere: Prisma.MarketplaceOrderWhereInput = { organizationId, marketplaceAccountId, ...this.periodWhere(p) };
    if (dimension === 'status') {
      const g = await this.prisma.marketplaceOrder.groupBy({
        by: ['normalizedStatus'], where: orderWhere, _count: { _all: true },
        _sum: { itemsSubtotal: true, marketplaceFeesTotal: true, productCostTotal: true, estimatedResult: true },
      });
      return g.map((x) => ({ key: NORMALIZED_LABELS[(x.normalizedStatus as NormalizedStatus) ?? 'OUTRO'], count: x._count._all, revenue: Number(x._sum.itemsSubtotal ?? 0), fees: Number(x._sum.marketplaceFeesTotal ?? 0), cost: Number(x._sum.productCostTotal ?? 0), result: Number(x._sum.estimatedResult ?? 0) }));
    }
    if (dimension === 'uf') {
      const g = await this.prisma.marketplaceOrder.groupBy({ by: ['uf'], where: orderWhere, _count: { _all: true }, _sum: { itemsSubtotal: true, estimatedResult: true } });
      return g.map((x) => ({ key: x.uf ?? '—', count: x._count._all, revenue: Number(x._sum.itemsSubtotal ?? 0), result: Number(x._sum.estimatedResult ?? 0) })).sort((a, b) => b.revenue - a.revenue).slice(0, 30);
    }
    if (dimension === 'city') {
      const g = await this.prisma.marketplaceOrder.groupBy({ by: ['city'], where: orderWhere, _count: { _all: true }, _sum: { itemsSubtotal: true, estimatedResult: true } });
      return g.map((x) => ({ key: x.city ?? '—', count: x._count._all, revenue: Number(x._sum.itemsSubtotal ?? 0), result: Number(x._sum.estimatedResult ?? 0) })).sort((a, b) => b.revenue - a.revenue).slice(0, 30);
    }
    // Dimensões de item: sku | product | family
    const items = await this.prisma.marketplaceOrderItem.findMany({
      where: { order: orderWhere },
      select: {
        sku: true, productName: true, quantity: true, productSubtotal: true, costTotal: true, estimatedResult: true, allocatedFees: true, skuLinked: true,
        productVariation: { select: { family: { select: { name: true } } } },
      },
    });
    const map = new Map<string, { key: string; count: number; units: number; revenue: number; fees: number; cost: number; result: number }>();
    for (const it of items) {
      let key: string;
      if (dimension === 'family') key = it.productVariation?.family?.name ?? '(sem família)';
      else if (dimension === 'product') key = it.productName ?? '(sem nome)';
      else key = it.sku ?? '(sem SKU)';
      const cur = map.get(key) ?? { key, count: 0, units: 0, revenue: 0, fees: 0, cost: 0, result: 0 };
      cur.count += 1; cur.units += it.quantity ?? 0;
      cur.revenue += Number(it.productSubtotal ?? 0);
      cur.fees += Number(it.allocatedFees ?? 0);
      cur.cost += Number(it.costTotal ?? 0);
      cur.result += Number(it.estimatedResult ?? 0);
      map.set(key, cur);
    }
    return [...map.values()].map((x) => ({ ...x, revenue: Math.round(x.revenue * 100) / 100, result: Math.round(x.result * 100) / 100, marginPct: x.revenue ? Math.round((x.result / x.revenue) * 10000) / 100 : null })).sort((a, b) => b.revenue - a.revenue).slice(0, 50);
  }

  listBatches(organizationId: string, marketplaceAccountId: string) {
    return this.prisma.salesImportBatch.findMany({
      where: { organizationId, marketplaceAccountId }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { createdBy: { select: { name: true } } },
    });
  }
}
