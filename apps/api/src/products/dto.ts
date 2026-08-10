import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { EntityStatus } from '@financeiro/shared';

export class ImportProductsDto {
  @IsString()
  marketplaceAccountId!: string;
}

const SORTS = [
  'name_asc',
  'name_desc',
  'stock_desc',
  'stock_asc',
  'price_desc',
  'price_asc',
  'variations_desc',
  'variations_asc',
  'without_family',
  'without_closing',
] as const;

export class ListProductsQueryDto {
  @IsOptional()
  @IsString()
  marketplaceAccountId?: string;

  /** Busca por nome do anúncio, ID do Produto, SKU, nome/ID da variação. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  familyId?: string;

  /** "with" | "without" — variações com/sem família (prompt §5/§20). */
  @IsOptional()
  @IsIn(['with', 'without'])
  family?: 'with' | 'without';

  /** "with" | "without" — variações com/sem preço de fechamento (prompt §20). */
  @IsOptional()
  @IsIn(['with', 'without'])
  closingPrice?: 'with' | 'without';

  /** Estoque: com estoque / sem estoque / estoque zerado (prompt §20). */
  @IsOptional()
  @IsIn(['with', 'without', 'zero'])
  stock?: 'with' | 'without' | 'zero';

  /** Produto sem variação / com variações (prompt §20). */
  @IsOptional()
  @IsIn(['single', 'multiple'])
  variations?: 'single' | 'multiple';

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsIn(SORTS as unknown as string[])
  sort?: (typeof SORTS)[number];

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}

export class BulkUpdateDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  variationIds!: string[];

  @IsOptional()
  @IsString()
  familyId?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  closingPrice?: string | null;

  @IsOptional()
  @IsEnum(EntityStatus)
  status?: EntityStatus;
}

export class SuggestFamiliesDto {
  @IsString()
  marketplaceAccountId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  variationIds!: string[];
}

export class CreateFamilyDto {
  @IsString()
  marketplaceAccountId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  internalCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Custo do produto (string decimal). Opcional: sem custo => "não informado". */
  @IsOptional()
  @IsString()
  cost?: string;

  @IsOptional()
  @IsString()
  costEffectiveFrom?: string;

  @IsOptional()
  @IsEnum(EntityStatus)
  status?: EntityStatus;
}

export class UpdateFamilyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  internalCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Novo custo. Se diferente do vigente, gera uma entrada no histórico (prompt §9). */
  @IsOptional()
  @IsString()
  cost?: string;

  @IsOptional()
  @IsString()
  costEffectiveFrom?: string;

  @IsOptional()
  @IsEnum(EntityStatus)
  status?: EntityStatus;
}

export class ClassifyVariationsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  variationIds!: string[];

  /** null = remover a classificação de família. */
  @IsOptional()
  @IsString()
  familyId?: string | null;
}

export class UpdateVariationDto {
  /** Preço de fechamento (string decimal) ou null para limpar. */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  closingPrice?: string | null;

  @IsOptional()
  @IsString()
  familyId?: string | null;

  @IsOptional()
  @IsString()
  internalNotes?: string;
}

export class ListFamiliesQueryDto {
  @IsOptional()
  @IsString()
  marketplaceAccountId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class ProductStatsQueryDto {
  @IsOptional()
  @IsString()
  marketplaceAccountId?: string;
}

export class ListProductBatchesQueryDto {
  @IsOptional()
  @IsString()
  marketplaceAccountId?: string;
}
