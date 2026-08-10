import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SUPPORTED_PROVIDERS } from './providers/factory';

export class UpdateAiSettingsDto {
  @IsOptional()
  @IsIn(SUPPORTED_PROVIDERS as unknown as string[])
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Chave em texto puro — cifrada no backend, nunca retornada. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearKey?: boolean;
}

export class AnalyzeDto {
  @IsString()
  marketplaceAccountId!: string;

  @IsString()
  functionKey!: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class ChatDto {
  @IsString()
  marketplaceAccountId!: string;

  @IsString()
  @MaxLength(600)
  question!: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class AiQueryDto {
  @IsString()
  marketplaceAccountId!: string;

  @IsOptional()
  @IsString()
  functionKey?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
