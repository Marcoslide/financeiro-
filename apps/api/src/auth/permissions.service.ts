import { Injectable } from '@nestjs/common';
import { Role } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Fase 10.2 item 9: perfil (AppRole) + overrides por usuário. Resolve o
 * conjunto EFETIVO de chaves de permissão para um usuário — é o que vira
 * claim assinada no JWT (auth.service.ts) e o que o front usa para
 * mostrar/esconder menu e telas (nunca o inverso: o front nunca decide
 * sozinho o que o usuário pode).
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async effectivePermissions(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        appRole: { include: { permissions: { include: { permission: true } } } },
        permissionOverrides: { include: { permission: true } },
      },
    });
    if (!user) return [];

    let base: string[];
    if (user.appRole) {
      base = user.appRole.permissions.map((rp) => rp.permission.key);
    } else {
      // Compatibilidade: usuário sem appRoleId (criado antes da Fase 10.2, ou
      // via a rota legada de apps/web) — cai no template cujo `key` bate com
      // o Role legado (os 4 templates OWNER/ADMIN/FINANCIAL/VIEWER sempre
      // existem na organização, ver seedPermissionsAndRoles).
      const fallbackRole = await this.prisma.appRole.findUnique({
        where: { organizationId_key: { organizationId: user.organizationId, key: user.role } },
        include: { permissions: { include: { permission: true } } },
      });
      base = fallbackRole?.permissions.map((rp) => rp.permission.key) ?? [];
    }

    const keys = new Set(base);
    for (const ov of user.permissionOverrides) {
      if (ov.allow) keys.add(ov.permission.key);
      else keys.delete(ov.permission.key);
    }
    // OWNER nunca fica sem nada, mesmo que o template/override esteja quebrado.
    if (user.role === Role.OWNER) {
      const all = await this.prisma.permission.findMany({ select: { key: true } });
      for (const p of all) keys.add(p.key);
    }
    return Array.from(keys);
  }
}
