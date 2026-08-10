import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { AuthUser, Role } from '@financeiro/shared';
import { AiService } from './ai.service';
import { CurrentUser, Roles } from '../common/decorators';
import { AiQueryDto, AnalyzeDto, ChatDto, UpdateAiSettingsDto } from './dto';

function period(q: { from?: string; to?: string }) {
  return { from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined };
}

@Controller('ai')
export class AiController {
  constructor(private readonly svc: AiService) {}

  @Get('settings')
  getSettings(@CurrentUser() u: AuthUser) {
    return this.svc.getSettings(u.organizationId);
  }

  @Put('settings')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  updateSettings(@CurrentUser() u: AuthUser, @Body() dto: UpdateAiSettingsDto) {
    return this.svc.updateSettings(u.organizationId, u.id, dto);
  }

  @Post('test')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  test(@CurrentUser() u: AuthUser) {
    return this.svc.testConnection(u.organizationId);
  }

  /** Evidências determinísticas (o que a IA "vê") — usado no Preview ao lado do chat. */
  @Get('evidence')
  evidence(@CurrentUser() u: AuthUser, @Query() q: AiQueryDto) {
    return this.svc.buildEvidence(u.organizationId, q.marketplaceAccountId, period(q));
  }

  @Post('analyze')
  @Roles(Role.ADMIN, Role.FINANCIAL, Role.VIEWER)
  analyze(@CurrentUser() u: AuthUser, @Body() dto: AnalyzeDto) {
    return this.svc.analyze(u.organizationId, u.id, dto.marketplaceAccountId, dto.functionKey, period(dto), { force: dto.force });
  }

  @Post('chat')
  @Roles(Role.ADMIN, Role.FINANCIAL, Role.VIEWER)
  chat(@CurrentUser() u: AuthUser, @Body() dto: ChatDto) {
    return this.svc.analyze(u.organizationId, u.id, dto.marketplaceAccountId, 'chat', period(dto), { question: dto.question, force: true });
  }

  @Get('history')
  history(@CurrentUser() u: AuthUser, @Query() q: AiQueryDto) {
    return this.svc.history(u.organizationId, q.marketplaceAccountId, q.functionKey);
  }
}
