import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { classifyExposure } from './exposure';

/**
 * Plano de Ação da Devolução (§33/§34/§63-§73). A ação nasce de um ACHADO/causa,
 * relaciona-se a SKUs/família/atributo e a um indicador, e é MEDIDA antes/depois
 * considerando o IMPACTO FINANCEIRO (não apenas quantidade). Medição determinística.
 */
const STATUSES = ['SUGGESTED', 'PLANNED', 'IN_PROGRESS', 'IMPLEMENTED', 'MEASURING', 'DONE', 'DISCARDED'];
const PRIORITIES = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'];

export interface ActionPlanDto {
  title?: string; description?: string | null; origin?: string | null; status?: string; priority?: string;
  ownerName?: string | null; dueDate?: string | null; indicator?: string | null;
  baselineValue?: number | null; targetValue?: number | null; financialImpact?: number | null;
  notes?: string | null; relatedSkus?: string[]; relatedFindings?: string[]; relatedCause?: string | null;
  implementedAt?: string | null; reviewAt?: string | null;
}

@Injectable()
export class ActionPlanService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(organizationId: string, marketplaceAccountId: string, status?: string) {
    const plans = await this.prisma.actionPlan.findMany({
      where: { organizationId, marketplaceAccountId, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { checklist: { orderBy: { order: 'asc' } } },
    });
    return Promise.all(plans.map((p) => this.withMeasure(p)));
  }

  async get(organizationId: string, id: string) {
    const p = await this.prisma.actionPlan.findFirst({ where: { id, organizationId }, include: { checklist: { orderBy: { order: 'asc' } } } });
    if (!p) throw new NotFoundException('Plano não encontrado.');
    return this.withMeasure(p);
  }

  async create(organizationId: string, userId: string, marketplaceAccountId: string, dto: ActionPlanDto) {
    if (!dto.title?.trim()) throw new BadRequestException('Título obrigatório.');
    if (dto.status && !STATUSES.includes(dto.status)) throw new BadRequestException('Status inválido.');
    if (dto.priority && !PRIORITIES.includes(dto.priority)) throw new BadRequestException('Prioridade inválida.');
    // Baseline automático: se não informado, mede o impacto atual do escopo (SKUs/causa).
    const baseline = dto.baselineValue != null ? dto.baselineValue : await this.measureScope(organizationId, marketplaceAccountId, dto.relatedSkus, dto.relatedCause);
    const plan = await this.prisma.actionPlan.create({
      data: {
        organizationId, marketplaceAccountId, title: dto.title.trim(), description: dto.description,
        origin: dto.origin ?? 'finding', status: dto.status ?? 'PLANNED', priority: dto.priority ?? 'MEDIA',
        ownerName: dto.ownerName, dueDate: dto.dueDate ? new Date(dto.dueDate) : null, indicator: dto.indicator ?? 'Impacto líquido do escopo',
        baselineValue: baseline == null ? null : baseline.toString(), targetValue: dto.targetValue == null ? null : dto.targetValue.toString(),
        notes: dto.notes, relatedSkus: (dto.relatedSkus ?? []) as unknown as Prisma.InputJsonValue,
        relatedFindings: (dto.relatedFindings ?? []) as unknown as Prisma.InputJsonValue,
        createdByUserId: userId,
      },
      include: { checklist: true },
    });
    await this.audit.record({ organizationId, userId, action: AuditAction.ACTION_PLAN_UPSERT, entityType: 'ActionPlan', entityId: plan.id, metadata: { title: plan.title, baseline } });
    return this.withMeasure(plan);
  }

  async update(organizationId: string, userId: string, id: string, dto: ActionPlanDto) {
    const cur = await this.prisma.actionPlan.findFirst({ where: { id, organizationId } });
    if (!cur) throw new NotFoundException('Plano não encontrado.');
    if (dto.status && !STATUSES.includes(dto.status)) throw new BadRequestException('Status inválido.');
    const data: Prisma.ActionPlanUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title!;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.ownerName !== undefined) data.ownerName = dto.ownerName;
    if (dto.indicator !== undefined) data.indicator = dto.indicator;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.reviewAt !== undefined) data.reviewAt = dto.reviewAt ? new Date(dto.reviewAt) : null;
    if (dto.baselineValue !== undefined) data.baselineValue = dto.baselineValue == null ? null : dto.baselineValue.toString();
    if (dto.targetValue !== undefined) data.targetValue = dto.targetValue == null ? null : dto.targetValue.toString();
    if (dto.financialImpact !== undefined) data.financialImpact = dto.financialImpact == null ? null : dto.financialImpact.toString();
    if (dto.relatedSkus !== undefined) data.relatedSkus = dto.relatedSkus as unknown as Prisma.InputJsonValue;
    // Marca implantação quando muda para IMPLEMENTED/MEASURING (§69 — inicia janela "depois").
    if (dto.status === 'IMPLEMENTED' || dto.status === 'MEASURING') data.implementedAt = cur.implementedAt ?? new Date();
    if (dto.implementedAt !== undefined) data.implementedAt = dto.implementedAt ? new Date(dto.implementedAt) : null;
    const plan = await this.prisma.actionPlan.update({ where: { id }, data, include: { checklist: { orderBy: { order: 'asc' } } } });
    await this.audit.record({ organizationId, userId, action: AuditAction.ACTION_PLAN_UPSERT, entityType: 'ActionPlan', entityId: id, metadata: { status: plan.status } });
    return this.withMeasure(plan);
  }

  async remove(organizationId: string, id: string) {
    const cur = await this.prisma.actionPlan.findFirst({ where: { id, organizationId } });
    if (!cur) throw new NotFoundException('Plano não encontrado.');
    await this.prisma.actionPlan.delete({ where: { id } });
    return { ok: true };
  }

  async addChecklistItem(organizationId: string, id: string, text: string) {
    await this.get(organizationId, id);
    const count = await this.prisma.actionPlanChecklistItem.count({ where: { planId: id } });
    await this.prisma.actionPlanChecklistItem.create({ data: { planId: id, text, order: count } });
    return this.get(organizationId, id);
  }
  async toggleChecklistItem(organizationId: string, id: string, itemId: string, done: boolean) {
    await this.get(organizationId, id);
    await this.prisma.actionPlanChecklistItem.update({ where: { id: itemId }, data: { done } });
    return this.get(organizationId, id);
  }

  /** Mede o impacto líquido atual do escopo do plano (SKUs e/ou causa). Determinístico. */
  private async measureScope(organizationId: string, marketplaceAccountId: string, skus?: string[], cause?: string | null, since?: Date): Promise<number> {
    const where: Prisma.PostSaleOccurrenceWhereInput = { organizationId, marketplaceAccountId };
    if (since) where.occurredAt = { gte: since };
    const or: Prisma.PostSaleOccurrenceWhereInput[] = [];
    if (skus && skus.length) or.push({ items: { some: { sku: { in: skus } } } });
    if (cause) or.push({ causeFamily: cause });
    if (or.length) where.OR = or;
    else if (!skus && !cause) return 0;
    const occ = await this.prisma.postSaleOccurrence.findMany({ where, select: { knownNetImpact: true } });
    return Math.round(occ.reduce((s, o) => s + Math.max(0, Number(o.knownNetImpact ?? 0)), 0) * 100) / 100;
  }

  /** Anexa a medição antes/depois (§34): baseline vs impacto atual e desde a implantação. */
  private async withMeasure(plan: Prisma.ActionPlanGetPayload<{ include: { checklist: true } }>) {
    const skus = (plan.relatedSkus as unknown as string[]) ?? [];
    const currentAll = await this.measureScope(plan.organizationId, plan.marketplaceAccountId, skus, null);
    const currentAfter = plan.implementedAt
      ? await this.measureScope(plan.organizationId, plan.marketplaceAccountId, skus, null, plan.implementedAt)
      : null;
    const baseline = plan.baselineValue == null ? null : Number(plan.baselineValue);
    const delta = baseline != null ? Math.round((currentAll - baseline) * 100) / 100 : null;
    return {
      ...plan,
      measure: {
        baseline, current: currentAll, currentAfterImplementation: currentAfter,
        delta, improved: delta != null ? delta < 0 : null,
        indicator: plan.indicator, hasScope: skus.length > 0,
      },
    };
  }
}
