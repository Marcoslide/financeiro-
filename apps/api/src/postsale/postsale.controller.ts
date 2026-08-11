import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, Role } from '@financeiro/shared';
import { PostSaleService } from './postsale.service';
import { OccurrenceOpsService } from './occurrence-ops.service';
import { OccurrenceAnalyticsService } from './occurrence-analytics.service';
import { ActionPlanService } from './action-plan.service';
import { CurrentUser, Roles } from '../common/decorators';
import { ActionPlanDtoIn, ActionPlanListDto, ChecklistItemDto, ChecklistToggleDto, CommentDto, DisputeDto, FinancialEventDto, ImportPostSaleDto, ListBatchesDto, ListOccurrencesDto, PatchOccurrenceDto, PostSaleQueryDto } from './dto';
import { PostSaleType } from './parsing/postsale-rows';

function period(q: { from?: string; to?: string }) {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  };
}

@Controller('post-sale')
export class PostSaleController {
  constructor(
    private readonly svc: PostSaleService,
    private readonly ops: OccurrenceOpsService,
    private readonly analytics: OccurrenceAnalyticsService,
    private readonly plans: ActionPlanService,
  ) {}

  @Get('causas')
  causas(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.analytics.causas(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  @Get('achados')
  achados(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.analytics.achados(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  // --- Plano de Ação ---
  @Get('action-plans')
  listPlans(@CurrentUser() u: AuthUser, @Query() q: ActionPlanListDto) {
    return this.plans.list(u.organizationId, q.marketplaceAccountId!, q.status);
  }

  @Post('action-plans')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  createPlan(@CurrentUser() u: AuthUser, @Query('marketplaceAccountId') accountId: string, @Body() dto: ActionPlanDtoIn) {
    return this.plans.create(u.organizationId, u.id, accountId, dto);
  }

  @Patch('action-plans/:id')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  updatePlan(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ActionPlanDtoIn) {
    return this.plans.update(u.organizationId, u.id, id, dto);
  }

  @Delete('action-plans/:id')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  removePlan(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.plans.remove(u.organizationId, id);
  }

  @Post('action-plans/:id/checklist')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  addChecklist(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ChecklistItemDto) {
    return this.plans.addChecklistItem(u.organizationId, id, dto.text);
  }

  @Patch('action-plans/:id/checklist')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  toggleChecklist(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ChecklistToggleDto) {
    return this.plans.toggleChecklistItem(u.organizationId, id, dto.itemId, dto.done !== false);
  }

  // --- Análise da Devolução (§3-§7,§20-§27) ---
  @Get('exec-overview')
  execOverview(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.analytics.overview(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  @Get('motivos')
  motivos(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.analytics.motivos(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  @Get('produtos-criticos')
  produtosCriticos(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.analytics.criticalProducts(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  @Get('financeiro')
  financeiro(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.analytics.financeiro(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  @Get('disputas')
  disputas(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.analytics.disputes(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  @Get('pendencias')
  pendencias(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.analytics.pendingQueue(u.organizationId, q.marketplaceAccountId!);
  }

  @Get('overview')
  overview(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.svc.overview(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  @Get('exposure')
  exposure(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.svc.exposure(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  @Get('findings')
  findings(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.svc.findings(u.organizationId, q.marketplaceAccountId!, period(q));
  }

  @Get('coverage')
  coverage(@CurrentUser() u: AuthUser, @Query() q: PostSaleQueryDto) {
    return this.svc.coverage(u.organizationId, q.marketplaceAccountId!);
  }

  @Get('occurrences')
  occurrences(@CurrentUser() u: AuthUser, @Query() q: ListOccurrencesDto) {
    return this.svc.listOccurrences(u.organizationId, q.marketplaceAccountId!, period(q), {
      type: q.type as PostSaleType | undefined,
      status: q.status,
      search: q.search,
      linked: q.linked,
      internalStatus: q.internalStatus,
      responsibility: q.responsibility,
      disputeStatus: q.disputeStatus,
      reason: q.reason,
      sort: q.sort,
      page: q.page ? parseInt(q.page, 10) : 1,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : 25,
    });
  }

  @Get('occurrences/:id')
  occurrence(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.ops.detail(u.organizationId, id);
  }

  // --- Operação da ficha (§8-§19) ---
  @Patch('occurrences/:id')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PatchOccurrenceDto) {
    return this.ops.patchInternal(u.organizationId, u.id, u.name, id, dto);
  }

  @Post('occurrences/:id/comment')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  comment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.ops.addComment(u.organizationId, u.id, u.name, id, dto.message);
  }

  @Post('occurrences/:id/financial-event')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  financialEvent(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: FinancialEventDto) {
    return this.ops.addFinancialEvent(u.organizationId, u.id, u.name, id, dto);
  }

  @Post('occurrences/:id/dispute')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  dispute(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DisputeDto) {
    return this.ops.resolveDispute(u.organizationId, u.id, u.name, id, dto);
  }

  @Get('import-batches')
  batches(@CurrentUser() u: AuthUser, @Query() q: ListBatchesDto) {
    return this.svc.listBatches(u.organizationId, q.marketplaceAccountId!, q.type as PostSaleType | undefined);
  }

  @Post('import')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  import(
    @CurrentUser() u: AuthUser,
    @Body() dto: ImportPostSaleDto,
    @UploadedFile() file?: { originalname: string; buffer: Buffer; size: number },
  ) {
    return this.svc.importReport(u.organizationId, u.id, dto.marketplaceAccountId, dto.type as PostSaleType, file);
  }
}
