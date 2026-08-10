import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, Role } from '@financeiro/shared';
import { OrdersService } from './orders.service';
import { CurrentUser, Roles } from '../common/decorators';
import { AnalyticsDto, ImportOrdersDto, ListOrdersDto, OrdersQueryDto } from './dto';

function period(q: { from?: string; to?: string }) {
  return { from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined };
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly svc: OrdersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListOrdersDto) {
    return this.svc.listOrders(u.organizationId, q.marketplaceAccountId, period(q), {
      tab: q.tab, search: q.search, status: q.status, linked: q.linked,
      costPending: q.costPending === 'true',
      sort: q.sort, page: q.page ? parseInt(q.page, 10) : 1, pageSize: q.pageSize ? parseInt(q.pageSize, 10) : 25,
    });
  }

  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthUser, @Query() q: OrdersQueryDto) {
    return this.svc.dashboard(u.organizationId, q.marketplaceAccountId, period(q));
  }

  @Get('analytics')
  analytics(@CurrentUser() u: AuthUser, @Query() q: AnalyticsDto) {
    return this.svc.analytics(u.organizationId, q.marketplaceAccountId, period(q), q.dimension);
  }

  @Get('import-batches')
  batches(@CurrentUser() u: AuthUser, @Query() q: OrdersQueryDto) {
    return this.svc.listBatches(u.organizationId, q.marketplaceAccountId);
  }

  @Get(':id')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.getOrder(u.organizationId, id);
  }

  @Post('import')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 60 * 1024 * 1024 } }))
  import(
    @CurrentUser() u: AuthUser,
    @Body() dto: ImportOrdersDto,
    @UploadedFile() file?: { originalname: string; buffer: Buffer; size: number },
  ) {
    return this.svc.importReport(u.organizationId, u.id, dto.marketplaceAccountId, file);
  }
}
