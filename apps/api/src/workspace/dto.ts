import { IsArray, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class PatchWorkspaceStoreDto {
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  puts?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deletes?: string[];
}
