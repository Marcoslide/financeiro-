import { IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@financeiro/shared';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha deve ter ao menos 8 caracteres.' })
  password!: string;

  // Role legado (compat apps/web) — nunca OWNER por esta rota (item 28: só o
  // bootstrap cria o Proprietário).
  @IsEnum(Role)
  role!: Role;

  // Fase 10.2 — perfil granular (id de AppRole). Opcional: sem ele o usuário
  // cai no fallback do Role legado (ver PermissionsService).
  @IsOptional()
  @IsString()
  appRoleId?: string;

  // item 18 — "Exigir alteração de senha no primeiro acesso".
  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;

  // item 15 — nomes de empresa/operação (IndexedDB do Sistema Marketplace)
  // que este usuário pode ver; vazio = sem restrição.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedCompanyNames?: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  appRoleId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedCompanyNames?: string[];
}
