import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@financeiro/shared';
import { PERMISSION_CATALOG } from '@financeiro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, UpdateRoleDto } from './dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** item 10 — catálogo completo, agrupado por módulo (pra tela renderizar por seção). */
  listPermissionCatalog() {
    const byModule = new Map<string, typeof PERMISSION_CATALOG>();
    for (const p of PERMISSION_CATALOG) {
      if (!byModule.has(p.module)) byModule.set(p.module, []);
      byModule.get(p.module)!.push(p);
    }
    return Array.from(byModule.entries()).map(([module, permissions]) => ({ module, permissions }));
  }

  async list(organizationId: string) {
    const roles = await this.prisma.appRole.findMany({
      where: { organizationId },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      isSystem: r.isSystem,
      status: r.status,
      userCount: r._count.users,
      permissionKeys: r.permissions.map((rp) => rp.permission.key),
    }));
  }

  private async syncPermissions(appRoleId: string, permissionKeys: string[]) {
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    await this.prisma.appRolePermission.deleteMany({ where: { appRoleId } });
    if (permissions.length) {
      await this.prisma.appRolePermission.createMany({
        data: permissions.map((p) => ({ appRoleId, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }

  /** item 20 — "Criar Perfil". Perfis criados aqui nunca são isSystem (só os 7 templates são). */
  async create(organizationId: string, actorId: string, dto: CreateRoleDto) {
    const invalid = dto.permissionKeys.filter((k) => !PERMISSION_CATALOG.some((p) => p.key === k));
    if (invalid.length) throw new BadRequestException(`Permissões desconhecidas: ${invalid.join(', ')}`);
    const role = await this.prisma.appRole.create({
      data: { organizationId, name: dto.name, isSystem: false },
    });
    await this.syncPermissions(role.id, dto.permissionKeys);
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.ROLE_CREATE,
      module: 'admin',
      entityType: 'AppRole',
      entityId: role.id,
      after: { name: dto.name, permissionKeys: dto.permissionKeys },
    });
    return this.list(organizationId).then((all) => all.find((r) => r.id === role.id));
  }

  /** item 20 — "Duplicar Perfil": mesma operação, cliente manda o nome novo + as mesmas permissionKeys. */
  async update(organizationId: string, actorId: string, id: string, dto: UpdateRoleDto) {
    const before = await this.prisma.appRole.findFirst({ where: { id, organizationId } });
    if (!before) throw new NotFoundException('Perfil não encontrado nesta organização.');
    if (dto.permissionKeys) {
      const invalid = dto.permissionKeys.filter((k) => !PERMISSION_CATALOG.some((p) => p.key === k));
      if (invalid.length) throw new BadRequestException(`Permissões desconhecidas: ${invalid.join(', ')}`);
    }
    await this.prisma.appRole.update({
      where: { id },
      data: {
        name: dto.name ?? before.name,
        status: dto.active === undefined ? before.status : dto.active ? 'ACTIVE' : 'INACTIVE',
      },
    });
    if (dto.permissionKeys) await this.syncPermissions(id, dto.permissionKeys);
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: dto.active === false ? AuditAction.ROLE_DEACTIVATE : AuditAction.ROLE_UPDATE,
      module: 'admin',
      entityType: 'AppRole',
      entityId: id,
      before: { name: before.name },
      after: { name: dto.name ?? before.name, permissionKeys: dto.permissionKeys },
    });
    return this.list(organizationId).then((all) => all.find((r) => r.id === id));
  }
}
