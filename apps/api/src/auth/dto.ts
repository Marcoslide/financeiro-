import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'E-mail inválido.' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Senha obrigatória.' })
  password!: string;
}

export class RefreshDto {
  // Fase 10.2: o "Sistema Marketplace — Líder" manda o refresh token só por
  // cookie httpOnly (nunca localStorage) — o body fica opcional para não
  // quebrar o apps/web, que continua enviando no corpo.
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}

export class BootstrapDto {
  @IsString()
  @MinLength(2)
  organizationName!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail({}, { message: 'E-mail inválido.' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha deve ter ao menos 8 caracteres.' })
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'A nova senha deve ter ao menos 8 caracteres.' })
  newPassword!: string;
}
