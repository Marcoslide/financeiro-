import { ScanCaptureMethod, ScanResolutionResult } from '@financeiro/database';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateOperationalLocationDto {
  @IsString() @MinLength(2) @MaxLength(40)
  code!: string;

  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(80)
  timezone?: string;
}

export class CreateScanStationDto {
  @IsString() @MinLength(2) @MaxLength(40)
  code!: string;

  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(160)
  deviceIdentifier?: string;
}

export class RegisterShipmentScanDto {
  @IsString() @MinLength(1) @MaxLength(160)
  code!: string;

  @IsOptional() @IsString()
  marketplaceAccountId?: string;

  @IsOptional() @IsString()
  workspaceOperationId?: string;

  @IsString()
  locationId!: string;

  @IsString()
  stationId!: string;

  @IsUUID()
  idempotencyKey!: string;

  @IsEnum(ScanCaptureMethod)
  captureMethod!: ScanCaptureMethod;

  @IsOptional() @IsISO8601()
  clientTimestamp?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class ListShipmentScansDto {
  @IsOptional() @IsISO8601()
  from?: string;

  @IsOptional() @IsISO8601()
  to?: string;

  @IsOptional() @IsEnum(ScanResolutionResult)
  result?: ScanResolutionResult;

  @IsOptional() @IsString()
  marketplaceAccountId?: string;

  @IsOptional() @IsString()
  workspaceOperationId?: string;

  @IsOptional() @IsString()
  userId?: string;

  @IsOptional() @IsString()
  locationId?: string;

  @IsOptional() @IsString()
  stationId?: string;

  @IsOptional() @IsString() @MaxLength(160)
  search?: string;

  @IsOptional() @IsString()
  page?: string;

  @IsOptional() @IsString()
  pageSize?: string;
}
