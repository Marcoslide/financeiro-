import { Controller, Get, Query } from '@nestjs/common';
import { Role, AuthUser } from '@financeiro/shared';
import { AuditService } from './audit.service';
import { CurrentUser, Roles } from '../common/decorators';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Trilha de auditoria da organização (somente ADMIN). */
  @Get()
  @Roles(Role.ADMIN)
  list(@CurrentUser() user: AuthUser, @Query('take') take?: string) {
    return this.audit.list(user.organizationId, take ? Number(take) : 100);
  }
}
