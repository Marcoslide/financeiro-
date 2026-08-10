import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, Role } from '@financeiro/shared';
import { PostSaleService } from './postsale.service';
import { CurrentUser, Roles } from '../common/decorators';
import { ImportPostSaleDto, ListBatchesDto, ListOccurrencesDto, PostSaleQueryDto } from './dto';
import { PostSaleType } from './parsing/postsale-rows';

function period(q: { from?: string; to?: string }) {
  return {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
  };
}

@Controller('post-sale')
export class PostSaleController {
  constructor(private readonly svc: PostSaleService) {}

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
      page: q.page ? parseInt(q.page, 10) : 1,
      pageSize: q.pageSize ? parseInt(q.pageSize, 10) : 25,
    });
  }

  @Get('occurrences/:id')
  occurrence(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.getOccurrence(u.organizationId, id);
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
