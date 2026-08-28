import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Role, AuthUser } from '@financeiro/shared';
import { AuditService } from './audit.service';
import { CreateLocalAuditLogDto } from './dto';
import { CurrentUser, Roles, RequirePermission } from '../common/decorators';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Trilha de auditoria da organização — item 21/40. */
  @Get()
  @Roles(Role.ADMIN)
  @RequirePermission('audit.view')
  list(@CurrentUser() user: AuthUser, @Query('take') take?: string) {
    return this.audit.list(user.organizationId, take ? Number(take) : 100);
  }

  /**
   * item 22 — registro de uma ação feita no "Sistema Marketplace — Líder"
   * (client-side, IndexedDB). Qualquer usuário autenticado pode chamar —
   * registra só a AÇÃO DELE, nunca em nome de outro (organizationId/userId
   * vêm do JWT, não do corpo). Falha aqui nunca deve travar a ação local
   * (item 23) — o front trata como best-effort/fire-and-forget.
   */
  @Post()
  @HttpCode(204)
  async recordLocal(@CurrentUser() user: AuthUser, @Body() dto: CreateLocalAuditLogDto) {
    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.id,
      userNameSnapshot: user.name,
      action: dto.action,
      module: dto.module,
      entityType: dto.entityType,
      entityId: dto.entityId,
      before: dto.before,
      after: dto.after,
      metadata: dto.metadata,
    });
  }
}
