import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { classifyExposure } from './exposure';

/**
 * Camada ANALÍTICA da Devolução (§3-§7, §20-§27, §31). Reproduz dinamicamente a
 * profundidade do estudo (sem hard-code): onde está o erro, motivos um a um,
 * produtos/SKUs críticos, exposição financeira com custos adicionais, disputas e
 * fila operacional. Tudo determinístico e a partir do ESTADO ATUAL (a operação
 * alimenta a inteligência §30): usa o impacto líquido conhecido recalculado pelos
 * eventos financeiros, não "reembolso = prejuízo".
 */
interface PeriodFilter { from?: Date; to?: Date }

const CAUSE_LABELS: Record<string, string> = {
  AVARIA: 'Avaria / quebra', SEPARACAO: 'Erro de separação', ARREPENDIMENTO: 'Arrependimento',
  LOGISTICA: 'Logística / extravio', QUALIDADE: 'Qualidade', SEM_MOTIVO: 'Sem motivo identificado',
};

type OccRow = {
  id: string; status: string | null; reason: string | null; reasonRevised: string | null;
  internalCause: string | null; causeFamily: string | null; responsibility: string;
  merchandiseStatus: string; disputeStatus: string; hasDispute: boolean; disputeDeadline: Date | null;
  disputeRespondedAt: Date | null; disputeContestedAmount: Prisma.Decimal | null; disputeRecoveredAmount: Prisma.Decimal | null;
  requestedRefundAmount: Prisma.Decimal | null; sellerCompensationAmount: Prisma.Decimal | null;
  knownNetImpact: Prisma.Decimal | null; recoveredTotal: Prisma.Decimal | null; additionalCostTotal: Prisma.Decimal | null;
  refundedTotal: Prisma.Decimal | null; occurredAt: Date | null; type: string; internalStatus: string;
  items: { sku: string | null; productName: string | null; skuLinked: boolean }[];
};

@Injectable()
export class OccurrenceAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private periodWhere(p: PeriodFilter): Prisma.PostSaleOccurrenceWhereInput {
    if (!p.from && !p.to) return {};
    const occurredAt: Prisma.DateTimeNullableFilter = {};
    if (p.from) occurredAt.gte = p.from;
    if (p.to) occurredAt.lte = p.to;
    return { occurredAt };
  }

  private async loadOccurrences(organizationId: string, marketplaceAccountId: string, p: PeriodFilter): Promise<OccRow[]> {
    return this.prisma.postSaleOccurrence.findMany({
      where: { organizationId, marketplaceAccountId, ...this.periodWhere(p) },
      select: {
        id: true, status: true, reason: true, reasonRevised: true, internalCause: true, causeFamily: true,
        responsibility: true, merchandiseStatus: true, disputeStatus: true, hasDispute: true, disputeDeadline: true,
        disputeRespondedAt: true, disputeContestedAmount: true, disputeRecoveredAmount: true,
        requestedRefundAmount: true, sellerCompensationAmount: true, knownNetImpact: true, recoveredTotal: true,
        additionalCostTotal: true, refundedTotal: true, occurredAt: true, type: true, internalStatus: true,
        items: { select: { sku: true, productName: true, skuLinked: true } },
      },
    }) as unknown as Promise<OccRow[]>;
  }

  /** Perda efetiva conhecida (impacto líquido recalculado pelos eventos). Nunca "reembolso = prejuízo". */
  private effectiveLoss(o: OccRow): number { return o.knownNetImpact == null ? 0 : Math.max(0, Number(o.knownNetImpact)); }
  private atRisk(o: OccRow): number { return classifyExposure(o).atRisk; }
  private num(d: Prisma.Decimal | null): number { return d == null ? 0 : Number(d); }
  private isGiveup(o: OccRow): boolean { return /cancel|desist|recus|rejeit/.test((o.status ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()); }
  private isApproved(o: OccRow): boolean { return /conclu|aprovad|reembols|pago|finaliz|sucesso|deferid/.test((o.status ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()); }
  private round(n: number): number { return Math.round(n * 100) / 100; }

  private disputeAggregate(occ: OccRow[], now: Date) {
    const soon = new Date(now.getTime() + 3 * 864e5);
    let possiveis = 0, abertas = 0, vencendo = 0, vencidas = 0, respondidas = 0, ganhas = 0, perdidas = 0, contestado = 0, recuperado = 0, prazoPerdido = 0;
    for (const o of occ) {
      const st = o.disputeStatus;
      if (st === 'POSSIVEL') possiveis++;
      if (['POSSIVEL', 'EM_PREPARACAO', 'RESPONDIDA', 'AGUARDANDO_SHOPEE'].includes(st)) abertas++;
      if (['EM_PREPARACAO', 'AGUARDANDO_SHOPEE', 'POSSIVEL'].includes(st) && o.disputeDeadline) {
        if (o.disputeDeadline < now) vencidas++; else if (o.disputeDeadline <= soon) vencendo++;
      }
      if (o.disputeRespondedAt || st === 'RESPONDIDA') respondidas++;
      if (st === 'GANHA' || st === 'PARCIAL') ganhas++;
      if (st === 'PERDIDA') perdidas++;
      if (st === 'PRAZO_PERDIDO') prazoPerdido++;
      contestado += this.num(o.disputeContestedAmount);
      recuperado += this.num(o.disputeRecoveredAmount);
    }
    const respondiveis = possiveis + respondidas + ganhas + perdidas;
    return {
      possiveis, abertas, vencendo, vencidas, respondidas, ganhas, perdidas, prazoPerdido,
      taxaResposta: respondiveis ? this.round((respondidas + ganhas + perdidas) / respondiveis * 100) : 0,
      valorContestado: this.round(contestado), valorRecuperado: this.round(recuperado),
    };
  }

  /** Visão Geral executiva (§3): indicadores + onde está o erro + críticos + disputas + pendências. */
  async overview(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const [occ, orderAgg] = await Promise.all([
      this.loadOccurrences(organizationId, marketplaceAccountId, p),
      this.prisma.marketplaceOrder.aggregate({ where: { organizationId, marketplaceAccountId, ...(p.from || p.to ? { orderCreatedAt: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}) }, _count: { _all: true }, _sum: { itemsSubtotal: true } }),
    ]);
    const totalOcc = occ.length;
    const orders = orderAgg._count._all;
    const revenue = this.num(orderAgg._sum.itemsSubtotal);
    let confirmedLoss = 0, atRisk = 0, recovered = 0, compensation = 0, additionalCost = 0, semRetorno = 0;
    for (const o of occ) {
      confirmedLoss += this.effectiveLoss(o); atRisk += this.atRisk(o);
      recovered += this.num(o.recoveredTotal); compensation += this.num(o.sellerCompensationAmount);
      additionalCost += this.num(o.additionalCostTotal);
      if (['PERDIDO', 'EXTRAVIADO'].includes(o.merchandiseStatus) || (o.merchandiseStatus === 'DESCONHECIDO' && this.isApproved(o))) semRetorno++;
    }
    const disputes = this.disputeAggregate(occ, new Date());
    return {
      indicators: {
        totalOccurrences: totalOcc, orders,
        returnRate: orders ? this.round(totalOcc / orders * 100) : null,
        lossOverRevenue: revenue ? this.round(confirmedLoss / revenue * 100) : null,
        confirmedLoss: this.round(confirmedLoss), atRisk: this.round(atRisk), recovered: this.round(recovered),
        compensation: this.round(compensation), additionalCost: this.round(additionalCost),
        productWithoutReturn: semRetorno,
        disputesOpen: disputes.abertas, disputesDueSoon: disputes.vencendo, disputeResponseRate: disputes.taxaResposta,
      },
      whereIsTheError: this.causeBreakdown(occ),
      criticalProducts: this.criticalProductsFrom(occ).slice(0, 5),
      topReasons: this.reasonsFrom(occ).slice(0, 5),
      disputes,
      pendingQueue: this.pendingFrom(occ, new Date()),
    };
  }

  /** "Onde está o erro" (§3): agrupa por família de causa (fallback: heurística do motivo). */
  private causeBreakdown(occ: OccRow[]) {
    const map = new Map<string, { key: string; label: string; cases: number; loss: number; atRisk: number }>();
    const total = occ.reduce((s, o) => s + this.effectiveLoss(o), 0) || 1;
    for (const o of occ) {
      const key = o.causeFamily || this.guessCause(o);
      const label = CAUSE_LABELS[key] || key;
      const cur = map.get(key) || { key, label, cases: 0, loss: 0, atRisk: 0 };
      cur.cases++; cur.loss += this.effectiveLoss(o); cur.atRisk += this.atRisk(o);
      map.set(key, cur);
    }
    return [...map.values()].map((c) => ({ ...c, loss: this.round(c.loss), atRisk: this.round(c.atRisk), shareOfLoss: this.round(c.loss / total * 100) })).sort((a, b) => b.loss - a.loss);
  }
  /** Heurística de causa a partir do motivo Shopee (só quando não há causa interna). */
  private guessCause(o: OccRow): string {
    const s = ((o.internalCause || o.reason || o.reasonRevised || '') as string).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/quebr|avar|dano|trinc|rachad/.test(s)) return 'AVARIA';
    if (/errad|troca|separac|item faltando|faltan|divergent/.test(s)) return 'SEPARACAO';
    if (/arrepend|desist|nao quero|gostei/.test(s)) return 'ARREPENDIMENTO';
    if (/entreg|extravi|transport|correi|logistic|nao recebi/.test(s)) return 'LOGISTICA';
    if (/defeit|qualidade|funciona|apresent/.test(s)) return 'QUALIDADE';
    return 'SEM_MOTIVO';
  }

  /** Motivos um a um (§4). */
  async motivos(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const occ = await this.loadOccurrences(organizationId, marketplaceAccountId, p);
    return this.reasonsFrom(occ);
  }
  private reasonsFrom(occ: OccRow[]) {
    const map = new Map<string, { reason: string; cases: number; approved: number; analyzing: number; giveups: number; loss: number; atRisk: number; compensation: number; ticketSum: number; returned: number }>();
    for (const o of occ) {
      const reason = (o.reason || o.reasonRevised || '(sem motivo informado)').trim();
      const cur = map.get(reason) || { reason, cases: 0, approved: 0, analyzing: 0, giveups: 0, loss: 0, atRisk: 0, compensation: 0, ticketSum: 0, returned: 0 };
      cur.cases++;
      if (this.isApproved(o)) cur.approved++; else if (this.isGiveup(o)) cur.giveups++; else cur.analyzing++;
      cur.loss += this.effectiveLoss(o); cur.atRisk += this.atRisk(o);
      cur.compensation += this.num(o.sellerCompensationAmount); cur.ticketSum += this.num(o.requestedRefundAmount);
      if (o.merchandiseStatus === 'RECEBIDO') cur.returned++;
      map.set(reason, cur);
    }
    return [...map.values()].map((r) => ({
      reason: r.reason, cases: r.cases, approved: r.approved, analyzing: r.analyzing, giveups: r.giveups,
      giveupRate: r.cases ? this.round(r.giveups / r.cases * 100) : 0,
      loss: this.round(r.loss), atRisk: this.round(r.atRisk), compensation: this.round(r.compensation),
      avgTicket: r.cases ? this.round(r.ticketSum / r.cases) : 0, returnedCount: r.returned,
    })).sort((a, b) => b.loss - a.loss || b.cases - a.cases);
  }

  /** Produtos & SKUs críticos (§6/§23). */
  async criticalProducts(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const occ = await this.loadOccurrences(organizationId, marketplaceAccountId, p);
    return this.criticalProductsFrom(occ);
  }
  private criticalProductsFrom(occ: OccRow[]) {
    const map = new Map<string, { sku: string; product: string | null; occurrences: number; loss: number; additionalCost: number; recovered: number; causes: Record<string, number>; linked: boolean }>();
    const totalLoss = occ.reduce((s, o) => s + this.effectiveLoss(o), 0) || 1;
    for (const o of occ) {
      // Rateia o impacto entre os SKUs distintos da ocorrência (valor contado uma vez).
      const skus = [...new Set(o.items.map((i) => i.sku).filter(Boolean) as string[])];
      const share = skus.length || 1;
      const cause = o.causeFamily || this.guessCause(o);
      for (const sku of skus) {
        const item = o.items.find((i) => i.sku === sku);
        const cur = map.get(sku) || { sku, product: item?.productName ?? null, occurrences: 0, loss: 0, additionalCost: 0, recovered: 0, causes: {}, linked: !!item?.skuLinked };
        cur.occurrences++; cur.loss += this.effectiveLoss(o) / share; cur.additionalCost += this.num(o.additionalCostTotal) / share; cur.recovered += this.num(o.recoveredTotal) / share;
        cur.causes[cause] = (cur.causes[cause] || 0) + 1;
        map.set(sku, cur);
      }
    }
    return [...map.values()].map((s) => {
      const dominant = Object.entries(s.causes).sort((a, b) => b[1] - a[1])[0];
      return { sku: s.sku, product: s.product, occurrences: s.occurrences, loss: this.round(s.loss), additionalCost: this.round(s.additionalCost), recovered: this.round(s.recovered), dominantCause: dominant ? (CAUSE_LABELS[dominant[0]] || dominant[0]) : '—', shareOfLoss: this.round(s.loss / totalLoss * 100), linked: s.linked };
    }).sort((a, b) => b.loss - a.loss || b.occurrences - a.occurrences).slice(0, 50);
  }

  /** Exposição financeira profunda (§16/§20). */
  async financeiro(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const occ = await this.loadOccurrences(organizationId, marketplaceAccountId, p);
    let refunded = 0, additional = 0, recovered = 0, compensation = 0, disputeRecovery = 0, confirmedLoss = 0, atRisk = 0, netImpact = 0;
    for (const o of occ) {
      refunded += this.num(o.refundedTotal); additional += this.num(o.additionalCostTotal);
      recovered += this.num(o.recoveredTotal); compensation += this.num(o.sellerCompensationAmount);
      disputeRecovery += this.num(o.disputeRecoveredAmount);
      confirmedLoss += this.effectiveLoss(o); atRisk += this.atRisk(o); netImpact += this.effectiveLoss(o);
    }
    return {
      refundedTotal: this.round(refunded), additionalCostTotal: this.round(additional), recoveredTotal: this.round(recovered),
      compensation: this.round(compensation), disputeRecovery: this.round(disputeRecovery),
      confirmedLoss: this.round(confirmedLoss), atRisk: this.round(atRisk), knownNetImpact: this.round(netImpact),
      cmvAvailable: false,
    };
  }

  async disputes(organizationId: string, marketplaceAccountId: string, p: PeriodFilter) {
    const occ = await this.loadOccurrences(organizationId, marketplaceAccountId, p);
    return this.disputeAggregate(occ, new Date());
  }

  async pendingQueue(organizationId: string, marketplaceAccountId: string) {
    const occ = await this.loadOccurrences(organizationId, marketplaceAccountId, {});
    return this.pendingFrom(occ, new Date());
  }
  /** Fila operacional (§27): o que precisa de ação agora, por prioridade determinística. */
  private pendingFrom(occ: OccRow[], now: Date) {
    const soon = new Date(now.getTime() + 3 * 864e5);
    let disputasVencendo = 0, aguardandoEvidencia = 0, aguardandoRetorno = 0, semCausaInterna = 0, skusNaoVinculados = 0, novas = 0;
    for (const o of occ) {
      if (['EM_PREPARACAO', 'AGUARDANDO_SHOPEE', 'POSSIVEL'].includes(o.disputeStatus) && o.disputeDeadline && o.disputeDeadline <= soon) disputasVencendo++;
      if (o.internalStatus === 'AGUARDANDO_EVIDENCIA') aguardandoEvidencia++;
      if (o.internalStatus === 'AGUARDANDO_RETORNO' || o.merchandiseStatus === 'AGUARDANDO_POSTAGEM' || o.merchandiseStatus === 'EM_TRANSITO') aguardandoRetorno++;
      if (!o.internalCause && !o.causeFamily) semCausaInterna++;
      if (o.items.some((i) => i.sku && !i.skuLinked)) skusNaoVinculados++;
      if (o.internalStatus === 'NOVA') novas++;
    }
    const items = [
      { key: 'disputasVencendo', label: 'Disputas vencendo (≤3 dias)', count: disputasVencendo, priority: 1 },
      { key: 'aguardandoEvidencia', label: 'Aguardando evidência', count: aguardandoEvidencia, priority: 2 },
      { key: 'aguardandoRetorno', label: 'Produtos aguardando retorno', count: aguardandoRetorno, priority: 3 },
      { key: 'semCausaInterna', label: 'Devoluções sem causa interna', count: semCausaInterna, priority: 4 },
      { key: 'novas', label: 'Ocorrências novas (sem triagem)', count: novas, priority: 5 },
      { key: 'skusNaoVinculados', label: 'SKUs não vinculados', count: skusNaoVinculados, priority: 6 },
    ].filter((i) => i.count > 0).sort((a, b) => a.priority - b.priority);
    return items;
  }
}
