import { IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

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

// --- Operação (Devolução) ---
export class PatchOccurrenceDto {
  @IsOptional() @IsString() internalStatus?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() ownerName?: string | null;
  @IsOptional() @IsString() internalCause?: string | null;
  @IsOptional() @IsString() causeFamily?: string | null;
  @IsOptional() @IsString() responsibility?: string;
  @IsOptional() @IsString() merchandiseStatus?: string;
  @IsOptional() @IsString() merchandiseCondition?: string | null;
  @IsOptional() @IsNumber() recoverableValue?: number | null;
  @IsOptional() @IsString() reasonRevised?: string | null;
  @IsOptional() @IsString() operatorNotes?: string | null;
  @IsOptional() @IsArray() checklist?: { text: string; done: boolean }[];
}

export class CommentDto {
  @IsString() @MaxLength(2000) message!: string;
}

export class FinancialEventDto {
  @IsString() type!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() direction?: string;
  @IsOptional() @IsString() occurredAt?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class DisputeDto {
  @IsOptional() @IsString() result?: string;
  @IsOptional() @IsNumber() recoveredAmount?: number;
  @IsOptional() @IsNumber() compensationAmount?: number;
  @IsOptional() @IsNumber() contestedAmount?: number;
  @IsOptional() @IsString() deadline?: string;
  @IsOptional() @IsString() respondedAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
