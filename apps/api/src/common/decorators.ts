import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role, AuthUser } from '@financeiro/shared';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marca uma rota como pública (sem autenticação). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restringe uma rota aos papéis informados. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const PERMISSION_KEY = 'permission';
/**
 * Fase 10.2 (item 7 — "autorização precisa ser validada também na camada
 * responsável pela operação/dado"): restringe uma rota a quem tem a
 * permissão informada nas claims da sessão (PermissionGuard). OWNER sempre
 * passa. Usar em conjunto com @Roles() ou sozinho — checagens independentes.
 */
export const RequirePermission = (key: string) => SetMetadata(PERMISSION_KEY, key);

/** Injeta o usuário autenticado (populado pelo JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);
