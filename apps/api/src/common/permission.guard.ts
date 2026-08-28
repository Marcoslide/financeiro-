import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, AuthUser } from '@financeiro/shared';
import { PERMISSION_KEY } from './decorators';

/**
 * Fase 10.2 — autorização por PERMISSÃO (item 7), separada de @Roles().
 * Sem @RequirePermission(), a rota não é afetada por este guard. OWNER
 * sempre passa (é sempre super-conjunto — item 2/28). A permissão vem da
 * claim assinada no JWT (JwtAuthGuard já populou request.user.permissions),
 * nunca de algo que o cliente possa reenviar/forjar.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('Você não tem permissão para esta ação.');
    if (user.role === Role.OWNER) return true;
    if (!user.permissions?.includes(required)) {
      throw new ForbiddenException('Você não tem permissão para esta ação.');
    }
    return true;
  }
}
