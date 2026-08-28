import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SetPermissionOverrideDto {
  @IsString()
  permissionKey!: string;

  @IsBoolean()
  allow!: boolean;
}
