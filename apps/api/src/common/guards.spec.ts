import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@financeiro/shared';
import { RolesGuard } from './roles.guard';
import { TenantGuard } from './tenant.guard';

function ctxWith(user: unknown): ExecutionContext {
  const req: any = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('permite quando não há papéis exigidos', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctxWith({ role: Role.VIEWER }))).toBe(true);
  });

  it('permite quando o papel do usuário é suficiente', () => {
    const reflector = { getAllAndOverride: () => [Role.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctxWith({ role: Role.ADMIN }))).toBe(true);
  });

  it('bloqueia VIEWER em rota de ADMIN', () => {
    const reflector = { getAllAndOverride: () => [Role.ADMIN] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(ctxWith({ role: Role.VIEWER }))).toThrow(ForbiddenException);
  });
});

describe('TenantGuard (isolamento)', () => {
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;

  it('injeta o tenant do usuário autenticado', () => {
    const guard = new TenantGuard(reflector);
    const req: any = { user: { organizationId: 'org_A' } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.tenant).toEqual({ organizationId: 'org_A' });
  });

  it('bloqueia quando não há organização no contexto', () => {
    const guard = new TenantGuard(reflector);
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow(ForbiddenException);
  });
});
