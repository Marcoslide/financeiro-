import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { recomputeOccurrenceImpact } from './impact-store';
import { defaultDirectionFor, isKnownEventType, EVENT_TYPES } from './impact';

/**
 * Camada OPERACIONAL da Devolução (§8-§19). A ocorrência deixa de ser leitura e
 * passa a ser uma ficha de trabalho: status interno, responsável, causa,
 * responsabilidade, mercadoria, disputa e eventos financeiros — tudo com timeline
 * e auditoria (§10/§29). A operação alimenta a inteligência (§30): cada mudança
 * recalcula o impacto determinístico (fonte única, §19).
 */

const INTERNAL_STATUS = ['NOVA', 'ANALISE', 'AGUARDANDO_EVIDENCIA', 'AGUARDANDO_RETORNO', 'EM_TRANSITO', 'RECEBIDO', 'EM_DISPUTA', 'AGUARDANDO_RESULTADO', 'RESOLVIDA', 'ENCERRADA', 'EXIGE_ACAO'];
const PRIORITY = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'];
const RESPONSIBILITY = ['OPERACAO', 'SHOPEE', 'LOGISTICA', 'COMPRADOR', 'COMPARTILHADA', 'NAO_IDENTIFICADA'];
const MERCH_STATUS = ['DESCONHECIDO', 'CLIENTE_POSSUI', 'RETORNO_DISPENSADO', 'AGUARDANDO_POSTAGEM', 'EM_TRANSITO', 'RECEBIDO', 'EXTRAVIADO', 'PERDIDO'];
const MERCH_COND = ['REAPROVEITAVEL', 'REQUER_RETRABALHO', 'AVARIADO', 'PERDA_TOTAL'];
const DISPUTE_STATUS = ['NAO_INICIADA', 'POSSIVEL', 'EM_PREPARACAO', 'RESPONDIDA', 'AGUARDANDO_SHOPEE', 'GANHA', 'PARCIAL', 'PERDIDA', 'PRAZO_PERDIDO', 'CANCELADA'];

export interface PatchInternalDto {
  internalStatus?: string; priority?: string; ownerName?: string | null;
  internalCause?: string | null; causeFamily?: string | null; responsibility?: string;
  merchandiseStatus?: string; merchandiseCondition?: string | null; recoverableValue?: number | null;
  reasonRevised?: string | null; operatorNotes?: string | null; checklist?: { text: string; done: boolean }[];
}

export interface FinancialEventDto {
  type: string; amount: number; direction?: string; occurredAt?: string; note?: string;
}

export interface DisputeDto {
  result?: string; recoveredAmount?: number; compensationAmount?: number; contestedAmount?: number;
  deadline?: string; respondedAt?: string; note?: string;
}

@Injectable()
export class OccurrenceOpsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async load(organizationId: string, id: string) {
    const occ = await this.prisma.postSaleOccurrence.findFirst({ where: { id, organizationId } });
    if (!occ) throw new NotFoundException('Ocorrência não encontrada.');
    return occ;
  }

  private async activity(occurrenceId: string, kind: string, data: { field?: string; oldValue?: string | null; newValue?: string | null; message?: string; userId?: string; userName?: string }) {
    await this.prisma.occurrenceActivity.create({ data: { occurrenceId, kind, ...data } });
  }

  /** Ficha completa (§8): dados Shopee + controle interno + eventos + timeline + impacto. */
  async detail(organizationId: string, id: string) {
    const occ = await this.prisma.postSaleOccurrence.findFirst({
      where: { id, organizationId },
      include: {
        order: { select: { id: true, externalOrderId: true, normalizedStatus: true, orderStatus: true, totalAmount: true } },
        items: { include: { productVariation: { select: { id: true, sku: true, product: { select: { name: true } }, family: { select: { name: true } } } } } },
        financialEvents: { orderBy: { occurredAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 200 },
        statusHistory: { orderBy: { observedAt: 'asc' } },
      },
    });
    if (!occ) throw new NotFoundException('Ocorrência não encontrada.');
    return {
      ...occ,
      impact: {
        refundedTotal: Number(occ.refundedTotal ?? 0),
        additionalCostTotal: Number(occ.additionalCostTotal ?? 0),
        recoveredTotal: Number(occ.recoveredTotal ?? 0),
        knownNetImpact: occ.knownNetImpact == null ? null : Number(occ.knownNetImpact),
        cmvAvailable: occ.cmvAvailable,
      },
    };
  }

  /** Atualiza campos de controle interno com timeline + auditoria (§8/§9/§10/§29). */
  async patchInternal(organizationId: string, userId: string, userName: string, id: string, dto: PatchInternalDto) {
    const occ = await this.load(organizationId, id);
    const data: Prisma.PostSaleOccurrenceUpdateInput = {};
    const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    const setEnum = (field: keyof PatchInternalDto, allowed: string[], col: string, cur: string | null) => {
      const v = dto[field] as string | undefined;
      if (v === undefined) return;
      if (!allowed.includes(v)) throw new BadRequestException(`Valor inválido para ${col}: ${v}`);
      if (v !== cur) { (data as Record<string, unknown>)[col] = v; changes.push({ field: col, oldValue: cur, newValue: v }); }
    };
    const setStr = (field: keyof PatchInternalDto, col: string, cur: string | null) => {
      if (dto[field] === undefined) return;
      const v = (dto[field] as string | null) ?? null;
      if (v !== cur) { (data as Record<string, unknown>)[col] = v; changes.push({ field: col, oldValue: cur, newValue: v }); }
    };
    setEnum('internalStatus', INTERNAL_STATUS, 'internalStatus', occ.internalStatus);
    setEnum('priority', PRIORITY, 'priority', occ.priority);
    setEnum('responsibility', RESPONSIBILITY, 'responsibility', occ.responsibility);
    setEnum('merchandiseStatus', MERCH_STATUS, 'merchandiseStatus', occ.merchandiseStatus);
    if (dto.merchandiseCondition !== undefined && dto.merchandiseCondition !== null && !MERCH_COND.includes(dto.merchandiseCondition)) throw new BadRequestException('Condição da mercadoria inválida.');
    setStr('ownerName', 'ownerName', occ.ownerName);
    setStr('internalCause', 'internalCause', occ.internalCause);
    setStr('causeFamily', 'causeFamily', occ.causeFamily);
    setStr('merchandiseCondition', 'merchandiseCondition', occ.merchandiseCondition);
    setStr('reasonRevised', 'reasonRevised', occ.reasonRevised);
    setStr('operatorNotes', 'operatorNotes', occ.operatorNotes);

    let recompute = false;
    if (dto.recoverableValue !== undefined) {
      const cur = occ.recoverableValue == null ? null : Number(occ.recoverableValue);
      const v = dto.recoverableValue == null ? null : Number(dto.recoverableValue);
      if (cur !== v) { data.recoverableValue = v == null ? null : v.toString(); changes.push({ field: 'recoverableValue', oldValue: cur?.toString() ?? null, newValue: v?.toString() ?? null }); recompute = true; }
    }
    if (dto.checklist !== undefined) { data.checklist = dto.checklist as unknown as Prisma.InputJsonValue; }

    if (Object.keys(data).length === 0) return this.detail(organizationId, id);
    await this.prisma.postSaleOccurrence.update({ where: { id }, data });
    for (const c of changes) await this.activity(id, 'CHANGE', { ...c, userId, userName });
    if (recompute) await recomputeOccurrenceImpact(this.prisma, id);
    await this.audit.record({ organizationId, userId, action: AuditAction.OCCURRENCE_UPDATE, entityType: 'PostSaleOccurrence', entityId: id, metadata: { changes: changes.map((c) => c.field) } });
    return this.detail(organizationId, id);
  }

  async addComment(organizationId: string, userId: string, userName: string, id: string, message: string) {
    await this.load(organizationId, id);
    if (!message?.trim()) throw new BadRequestException('Comentário vazio.');
    await this.activity(id, 'COMMENT', { message: message.trim(), userId, userName });
    return this.detail(organizationId, id);
  }

  /** Lançamento manual de custo/recuperação (§18). Idempotente por dedupeKey. */
  async addFinancialEvent(organizationId: string, userId: string, userName: string, id: string, dto: FinancialEventDto) {
    const occ = await this.load(organizationId, id);
    if (!isKnownEventType(dto.type)) throw new BadRequestException(`Tipo de evento inválido: ${dto.type}`);
    if (dto.amount == null || isNaN(Number(dto.amount)) || Number(dto.amount) < 0) throw new BadRequestException('Valor inválido.');
    const direction = dto.direction ?? defaultDirectionFor(dto.type);
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const dedupeKey = `manual:${dto.type}:${occurredAt.getTime()}:${Number(dto.amount)}`;
    await this.prisma.occurrenceFinancialEvent.upsert({
      where: { occurrenceId_dedupeKey: { occurrenceId: id, dedupeKey } },
      create: { organizationId: occ.organizationId, occurrenceId: id, type: dto.type, direction, amount: Number(dto.amount).toString(), occurredAt, source: 'MANUAL', createdByUserId: userId, createdByName: userName, note: dto.note, dedupeKey },
      update: {},
    });
    const impact = await recomputeOccurrenceImpact(this.prisma, id);
    await this.activity(id, 'FINANCIAL', { message: `${EVENT_TYPES[dto.type as keyof typeof EVENT_TYPES]?.label ?? dto.type}: R$ ${Number(dto.amount).toFixed(2)}`, userId, userName });
    await this.audit.record({ organizationId, userId, action: AuditAction.OCCURRENCE_FINANCIAL, entityType: 'PostSaleOccurrence', entityId: id, metadata: { type: dto.type, amount: Number(dto.amount), impact } });
    return this.detail(organizationId, id);
  }

  /**
   * Resolve/atualiza a disputa (§11/§12). Ao ganhar/parcial com valor recuperado,
   * cria evento RECUPERACAO_DISPUTA idempotente e recalcula o impacto — a operação
   * alimenta a inteligência (a partir daqui não se trata mais como perda integral).
   */
  async resolveDispute(organizationId: string, userId: string, userName: string, id: string, dto: DisputeDto) {
    const occ = await this.load(organizationId, id);
    if (dto.result && !DISPUTE_STATUS.includes(dto.result)) throw new BadRequestException(`Resultado de disputa inválido: ${dto.result}`);
    const data: Prisma.PostSaleOccurrenceUpdateInput = { hasDispute: true };
    const prev = occ.disputeStatus;
    if (dto.result) data.disputeStatus = dto.result;
    if (dto.deadline !== undefined) data.disputeDeadline = dto.deadline ? new Date(dto.deadline) : null;
    if (dto.respondedAt !== undefined) data.disputeRespondedAt = dto.respondedAt ? new Date(dto.respondedAt) : null;
    if (dto.contestedAmount !== undefined) data.disputeContestedAmount = dto.contestedAmount?.toString() ?? null;
    if (dto.recoveredAmount !== undefined) data.disputeRecoveredAmount = dto.recoveredAmount?.toString() ?? null;
    if (dto.note !== undefined) data.disputeNote = dto.note;
    // Disputa em curso reflete no status interno.
    if (dto.result === 'GANHA' || dto.result === 'PARCIAL' || dto.result === 'PERDIDA' || dto.result === 'PRAZO_PERDIDO') data.internalStatus = 'RESOLVIDA';
    else if (dto.result && ['POSSIVEL', 'EM_PREPARACAO', 'RESPONDIDA', 'AGUARDANDO_SHOPEE'].includes(dto.result)) data.internalStatus = 'EM_DISPUTA';
    await this.prisma.postSaleOccurrence.update({ where: { id }, data });

    // Evento financeiro de recuperação (idempotente) quando a disputa é ganha/parcial.
    if ((dto.result === 'GANHA' || dto.result === 'PARCIAL') && dto.recoveredAmount && dto.recoveredAmount > 0) {
      await this.prisma.occurrenceFinancialEvent.upsert({
        where: { occurrenceId_dedupeKey: { occurrenceId: id, dedupeKey: 'dispute:recovery' } },
        create: { organizationId: occ.organizationId, occurrenceId: id, type: 'RECUPERACAO_DISPUTA', direction: 'RECOVERY', amount: Number(dto.recoveredAmount).toString(), source: 'MANUAL', createdByUserId: userId, createdByName: userName, note: 'Recuperação de disputa', dedupeKey: 'dispute:recovery' },
        update: { amount: Number(dto.recoveredAmount).toString() },
      });
    }
    if (dto.compensationAmount && dto.compensationAmount > 0) {
      await this.prisma.occurrenceFinancialEvent.upsert({
        where: { occurrenceId_dedupeKey: { occurrenceId: id, dedupeKey: 'dispute:compensation' } },
        create: { organizationId: occ.organizationId, occurrenceId: id, type: 'COMPENSACAO_SHOPEE', direction: 'RECOVERY', amount: Number(dto.compensationAmount).toString(), source: 'MANUAL', createdByUserId: userId, createdByName: userName, note: 'Compensação (disputa)', dedupeKey: 'dispute:compensation' },
        update: { amount: Number(dto.compensationAmount).toString() },
      });
    }
    const impact = await recomputeOccurrenceImpact(this.prisma, id);
    await this.activity(id, 'DISPUTE', { field: 'disputeStatus', oldValue: prev, newValue: dto.result ?? prev, message: dto.recoveredAmount ? `Recuperado R$ ${Number(dto.recoveredAmount).toFixed(2)}` : undefined, userId, userName });
    await this.audit.record({ organizationId, userId, action: AuditAction.OCCURRENCE_DISPUTE, entityType: 'PostSaleOccurrence', entityId: id, metadata: { result: dto.result, recovered: dto.recoveredAmount, impact } });
    return this.detail(organizationId, id);
  }
}
