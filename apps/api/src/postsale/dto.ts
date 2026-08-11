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
  @IsOptional() @IsString() internalStatus?: string;
  @IsOptional() @IsString() responsibility?: string;
  @IsOptional() @IsString() disputeStatus?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() sort?: string;
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

// --- Plano de Ação (§33/§34/§63-§73) ---
export class ActionPlanDtoIn {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsString() origin?: string | null;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() ownerName?: string | null;
  @IsOptional() @IsString() dueDate?: string | null;
  @IsOptional() @IsString() indicator?: string | null;
  @IsOptional() @IsNumber() baselineValue?: number | null;
  @IsOptional() @IsNumber() targetValue?: number | null;
  @IsOptional() @IsNumber() financialImpact?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsArray() relatedSkus?: string[];
  @IsOptional() @IsArray() relatedFindings?: string[];
  @IsOptional() @IsString() relatedCause?: string | null;
  @IsOptional() @IsString() implementedAt?: string | null;
  @IsOptional() @IsString() reviewAt?: string | null;
}

export class ChecklistItemDto {
  @IsString() @MaxLength(300) text!: string;
}
export class ChecklistToggleDto {
  @IsString() itemId!: string;
  @IsOptional() done?: boolean;
}
export class ActionPlanListDto extends PostSaleQueryDto {
  @IsOptional() @IsString() status?: string;
}
