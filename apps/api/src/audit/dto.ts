import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { AuditAction } from '@financeiro/shared';

/**
 * item 22 — o "Sistema Marketplace — Líder" (100% client-side, IndexedDB)
 * chama isto depois de cada ação local relevante (criar/editar/cancelar CP,
 * fechar Caixa, classificar Carteira, etc.). A mutação em si NUNCA passa por
 * aqui — só o registro paralelo, imutável, de que ela aconteceu (item 23).
 * Quem fez e em qual organização vêm SEMPRE de request.user (JWT验证),
 * nunca do corpo — ninguém pode registrar uma ação em nome de outro usuário.
 */
export class CreateLocalAuditLogDto {
  @IsEnum(AuditAction)
  action!: AuditAction;

  @IsOptional()
  @IsString()
  module?: string;

  @IsString()
  entityType!: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsObject()
  before?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  after?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
