import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId: string;
  userId?: string | null;
  /// Fase 10.2 item 21 — snapshot do nome no momento da ação (sobrevive a
  /// renomeação/exclusão posterior do usuário).
  userNameSnapshot?: string | null;
  action: string;
  /// Módulo de origem (ex.: "contas-a-pagar", "caixa") — só usado pela tela
  /// de Auditoria pra filtrar; nunca lido pelos motores financeiros.
  module?: string | null;
  entityType: string;
  entityId?: string | null;
  marketplaceAccountId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registra uma ação auditável (quem, o quê, antes/depois). */
  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        userId: entry.userId ?? null,
        userNameSnapshot: entry.userNameSnapshot ?? null,
        action: entry.action,
        module: entry.module ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        marketplaceAccountId: entry.marketplaceAccountId ?? null,
        beforePayload: (entry.before ?? undefined) as any,
        afterPayload: (entry.after ?? undefined) as any,
        metadata: (entry.metadata ?? undefined) as any,
      },
    });
  }

  /** Lista os registros da organização (mais recentes primeiro). */
  async list(organizationId: string, take = 100) {
    return this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { name: true, email: true } } },
    });
  }
}
