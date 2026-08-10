import { IsBooleanString, IsIn, IsOptional, IsString } from 'class-validator';

export class OrdersQueryDto {
  @IsString()
  marketplaceAccountId!: string;

  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class ListOrdersDto extends OrdersQueryDto {
  @IsOptional() @IsString() tab?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsIn(['linked', 'unlinked']) linked?: 'linked' | 'unlinked';
  @IsOptional() @IsBooleanString() costPending?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

export class AnalyticsDto extends OrdersQueryDto {
  @IsIn(['sku', 'product', 'family', 'status', 'uf', 'city'])
  dimension!: string;
}

export class ImportOrdersDto {
  @IsString()
  marketplaceAccountId!: string;
}
