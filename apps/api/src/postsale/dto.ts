import { IsIn, IsOptional, IsString } from 'class-validator';

const TYPES = ['RETURN_REFUND', 'ORDER_CANCELLATION', 'FAILED_DELIVERY'] as const;

export class ImportPostSaleDto {
  @IsString()
  marketplaceAccountId!: string;

  @IsIn(TYPES as unknown as string[])
  type!: (typeof TYPES)[number];
}

export class PostSaleQueryDto {
  @IsOptional() @IsString() marketplaceAccountId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class ListOccurrencesDto extends PostSaleQueryDto {
  @IsOptional() @IsIn(TYPES as unknown as string[]) type?: (typeof TYPES)[number];
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['linked', 'unlinked']) linked?: 'linked' | 'unlinked';
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

export class ListBatchesDto extends PostSaleQueryDto {
  @IsOptional() @IsIn(TYPES as unknown as string[]) type?: (typeof TYPES)[number];
}
