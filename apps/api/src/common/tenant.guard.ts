import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '@financeiro/shared';
import { IS_PUBLIC_KEY } from './decorators';

/**
 * Isolamento multiloja: garante que há uma organização no contexto e a
 * disponibiliza em request.tenant. Os serviços SEMPRE filtram por
 * request.tenant.organizationId, de modo que dados de uma organização nunca
 * vazam para outra. Rotas @Public() são ignoradas. Ver docs/bloco-1-plano.md §3.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user?.organizationId) {
      throw new ForbiddenException('Contexto de organização ausente.');
    }
    request.tenant = { organizationId: user.organizationId };
    return true;
  }
}
