import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role, AuthUser } from '@financeiro/shared';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marca uma rota como pública (sem autenticação). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restringe uma rota aos papéis informados. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Injeta o usuário autenticado (populado pelo JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthUser;
  },
);
