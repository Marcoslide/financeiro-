import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, Role, ReportType } from '@financeiro/shared';
import { ImportsService } from './imports.service';
import { CurrentUser, Roles } from '../common/decorators';
import { AnalyzeImportDto, ConfirmImportDto, ListImportsQueryDto, ListRowsQueryDto } from './dto';

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** Lista de lotes (leitura — inclusive VIEWER). */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListImportsQueryDto) {
    return this.imports.list(user.organizationId, query.marketplaceAccountId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.imports.get(user.organizationId, id);
  }

  @Get(':id/rows')
  rows(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: ListRowsQueryDto) {
    return this.imports.rows(user.organizationId, id, {
      status: query.status,
      issue: query.issue,
      page: query.page ? parseInt(query.page, 10) : 1,
    });
  }

  /** Fase 1 — envia e analisa (ADMIN/FINANCIAL). VIEWER é bloqueado. */
  @Post('analyze')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  analyze(
    @CurrentUser() user: AuthUser,
    @Body() dto: AnalyzeImportDto,
    @UploadedFile() file?: { originalname: string; buffer: Buffer; size: number },
  ) {
    return this.imports.analyze(
      user.organizationId,
      user.id,
      dto.marketplaceAccountId,
      dto.reportType as ReportType | undefined,
      file,
    );
  }

  /** Fase 2 — confirma e processa (ADMIN/FINANCIAL). */
  @Post(':id/confirm')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConfirmImportDto) {
    return this.imports.confirm(user.organizationId, user.id, id, dto);
  }

  /** Reprocessa o mesmo arquivo (ADMIN/FINANCIAL). */
  @Post(':id/reprocess')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  reprocess(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConfirmImportDto) {
    return this.imports.reprocess(user.organizationId, user.id, id, dto);
  }

  /** Descarta um lote ainda não confirmado (ADMIN/FINANCIAL). */
  @Delete(':id')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  discard(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.imports.discard(user.organizationId, user.id, id);
  }
}
