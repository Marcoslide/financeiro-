import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuditAction, Role } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, UpdateUserDto } from './dto';

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
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
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(organizationId: string, actorId: string, dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Já existe um usuário com este e-mail.');
    }
    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        organizationId,
        name: dto.name,
        email: dto.email,
        role: dto.role,
        passwordHash,
      },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.USER_CREATE,
      entityType: 'User',
      entityId: user.id,
      after: { name: user.name, email: user.email, role: user.role },
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
    const updated = await this.prisma.user.update({
      where: { id },
      data: { name: dto.name ?? before.name, role: (dto.role ?? before.role) as Role },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.USER_UPDATE,
      entityType: 'User',
      entityId: id,
      before: { name: before.name, role: before.role },
      after: { name: updated.name, role: updated.role },
    });
    return updated;
  }

  async deactivate(organizationId: string, actorId: string, id: string) {
    const before = await this.getOwned(organizationId, id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE' },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.USER_DEACTIVATE,
      entityType: 'User',
      entityId: id,
      before: { status: before.status },
      after: { status: updated.status },
    });
    return updated;
  }
}
