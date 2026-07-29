import { IsEnum, IsOptional, IsString } from 'class-validator';
import { IngestionSource, ReportType } from '@financeiro/shared';

export class AnalyzeImportDto {
  @IsString()
  marketplaceAccountId!: string;

  /** Correção manual do tipo já na análise (opcional). */
  @IsOptional()
  @IsEnum(ReportType)
  reportType?: ReportType;
}

export class ConfirmImportDto {
  /** Correção manual do tipo detectado (opcional). */
  @IsOptional()
  @IsEnum(ReportType)
  reportType?: ReportType;

  @IsOptional()
  @IsEnum(IngestionSource)
  ingestionSource?: IngestionSource;
}

export class ListImportsQueryDto {
  @IsOptional()
  @IsString()
  marketplaceAccountId?: string;
}

export class ListRowsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  /** "warning" | "error" — filtra linhas que têm alerta/erro. */
  @IsOptional()
  @IsString()
  issue?: string;

  @IsOptional()
  @IsString()
  page?: string;
}
