import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuditAction, Role } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { normalizeEmail } from '../common/email';

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  appRoleId: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  allowedCompanyNames: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lista SEMPRE filtrando pela organização do solicitante (isolamento). */
  list(organizationId: string) {
    return this.prisma.user.findMany({
      where: { organizationId },
      select: { ...PUBLIC_FIELDS, appRole: { select: { id: true, name: true, key: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(organizationId: string, actorId: string, dto: CreateUserDto) {
    // item 28 — OWNER só nasce pelo bootstrap (apps/api/src/auth). Ninguém
    // cria um segundo Proprietário por esta rota administrativa.
    if (dto.role === Role.OWNER) {
      throw new ForbiddenException('O Proprietário não pode ser criado por aqui.');
    }
    // item 8 da correção urgente — o DTO já normaliza (trim+lowercase), mas a
    // checagem de duplicidade é case-insensitive por segurança extra: cobre
    // qualquer linha antiga que ainda tenha caixa diferente da normalizada.
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findFirst({
      where: { organizationId, email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('Já existe um usuário cadastrado com este e-mail.');
    }
    if (dto.appRoleId) {
      const role = await this.prisma.appRole.findFirst({ where: { id: dto.appRoleId, organizationId } });
      if (!role) throw new BadRequestException('Perfil não encontrado nesta organização.');
    }
    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        organizationId,
        name: dto.name,
        email,
        role: dto.role,
        appRoleId: dto.appRoleId ?? null,
        passwordHash,
        // item 18 — por padrão exige troca de senha no primeiro acesso; o
        // admin pode desmarcar explicitamente ao criar.
        mustChangePassword: dto.mustChangePassword ?? true,
        allowedCompanyNames: dto.allowedCompanyNames ?? [],
        createdBy: actorId,
        updatedBy: actorId,
      },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.USER_CREATE,
      module: 'admin',
      entityType: 'User',
      entityId: user.id,
      after: { name: user.name, email: user.email, role: user.role, appRoleId: user.appRoleId },
    });
    return user;
  }

  private async getOwned(organizationId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, organizationId } });
    if (!user) throw new NotFoundException('Usuário não encontrado nesta organização.');
    return user;
  }

  async update(organizationId: string, actorId: string, id: string, dto: UpdateUserDto) {
    const before = await this.getOwned(organizationId, id);
    // item 28 — o Proprietário nunca é rebaixado nem promovido por esta rota,
    // não importa quem está pedindo (nem o próprio OWNER — trocar de dono é
    // um fluxo à parte, fora do escopo desta fase).
    if (before.role === Role.OWNER && dto.role && dto.role !== Role.OWNER) {
      throw new ForbiddenException('O Proprietário não pode ser rebaixado.');
    }
    if (dto.role === Role.OWNER && before.role !== Role.OWNER) {
      throw new ForbiddenException('Não é possível promover um usuário a Proprietário por aqui.');
    }
    if (dto.appRoleId) {
      const role = await this.prisma.appRole.findFirst({ where: { id: dto.appRoleId, organizationId } });
      if (!role) throw new BadRequestException('Perfil não encontrado nesta organização.');
    }
    // item 16 — trocar e-mail passa pela mesma checagem de duplicidade
    // case-insensitive que a criação usa.
    let email = before.email;
    if (dto.email !== undefined) {
      email = normalizeEmail(dto.email);
      if (email !== before.email.toLowerCase()) {
        const dupe = await this.prisma.user.findFirst({
          where: { organizationId, email: { equals: email, mode: 'insensitive' }, id: { not: id } },
        });
        if (dupe) throw new ConflictException('Já existe um usuário cadastrado com este e-mail.');
      }
    }
    // item 20 — "troca de perfil" cobre tanto o Role legado quanto o perfil
    // granular (appRoleId), que é o que de fato controla as permissões na UI.
    const roleChanged = dto.role !== undefined && dto.role !== before.role;
    const appRoleChanged = dto.appRoleId !== undefined && dto.appRoleId !== before.appRoleId;
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name ?? before.name,
        email,
        role: (dto.role ?? before.role) as Role,
        appRoleId: dto.appRoleId !== undefined ? dto.appRoleId : before.appRoleId,
        allowedCompanyNames: dto.allowedCompanyNames ?? before.allowedCompanyNames,
        updatedBy: actorId,
      },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.USER_UPDATE,
      module: 'admin',
      entityType: 'User',
      entityId: id,
      before: { name: before.name, email: before.email, role: before.role, appRoleId: before.appRoleId },
      after: { name: updated.name, email: updated.email, role: updated.role, appRoleId: updated.appRoleId },
    });
    // item 20 — troca de perfil (role legado e/ou perfil granular) é auditada
    // também com uma ação própria, separada do USER_UPDATE genérico, para
    // facilitar auditoria de acesso.
    if (roleChanged || appRoleChanged) {
      await this.audit.record({
        organizationId,
        userId: actorId,
        action: AuditAction.USER_ROLE_CHANGE,
        module: 'admin',
        entityType: 'User',
        entityId: id,
        before: { role: before.role, appRoleId: before.appRoleId },
        after: { role: updated.role, appRoleId: updated.appRoleId },
      });
    }
    return updated;
  }

  async deactivate(organizationId: string, actorId: string, id: string) {
    const before = await this.getOwned(organizationId, id);
    // item 28 — nunca desativa o Proprietário.
    if (before.role === Role.OWNER) {
      throw new ForbiddenException('O Proprietário não pode ser desativado.');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE', updatedBy: actorId },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.USER_DEACTIVATE,
      module: 'admin',
      entityType: 'User',
      entityId: id,
      before: { status: before.status },
      after: { status: updated.status },
    });
    return updated;
  }

  /** item 18/19 — reativa um usuário desativado (nunca exclui fisicamente). */
  async activate(organizationId: string, actorId: string, id: string) {
    const before = await this.getOwned(organizationId, id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE', updatedBy: actorId },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.USER_ENABLE,
      module: 'admin',
      entityType: 'User',
      entityId: id,
      before: { status: before.status },
      after: { status: updated.status },
    });
    return updated;
  }
}
