import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { AuthUser, AuditAction, Role } from '@financeiro/shared';
import { EntityStatus, seedPermissionsAndRoles } from '@financeiro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from './permissions.service';
import { normalizeEmail } from '../common/email';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Fase 10.2 item 31: throttle mínimo — não substitui um limitador real (Redis)
 * em produção multi-instância, mas evita força bruta trivial no MVP. Nunca
 * bloqueia permanentemente: a janela expira sozinha. */
const LOGIN_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_ATTEMPT_MAX = 8;

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, { count: number; windowStartedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private toAuthUser(u: {
    id: string;
    name: string;
    email: string;
    role: string;
    organizationId: string;
  }): AuthUser {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role as Role,
      organizationId: u.organizationId,
    };
  }

  private checkThrottle(key: string): void {
    const now = Date.now();
    const entry = this.loginAttempts.get(key);
    if (!entry || now - entry.windowStartedAt > LOGIN_ATTEMPT_WINDOW_MS) {
      this.loginAttempts.set(key, { count: 1, windowStartedAt: now });
      return;
    }
    entry.count += 1;
    if (entry.count > LOGIN_ATTEMPT_MAX) {
      throw new UnauthorizedException('Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
    }
  }

  private clearThrottle(key: string): void {
    this.loginAttempts.delete(key);
  }

  async validateUser(email: string, password: string, throttleKey?: string): Promise<AuthUser> {
    if (throttleKey) this.checkThrottle(throttleKey);
    // item 8 da correção urgente — e-mail é o login: busca sempre
    // case-insensitive (o DTO já normaliza, mas aqui é a defesa final).
    const normalized = normalizeEmail(email);
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalized, mode: 'insensitive' } },
    });
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Usuário inativo. Procure o administrador.');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    if (throttleKey) this.clearThrottle(throttleKey);
    return this.toAuthUser(user);
  }

  async issueTokens(user: AuthUser): Promise<AuthTokens> {
    const accessTtl = this.config.get<number>('JWT_ACCESS_TTL')!;
    const refreshTtl = this.config.get<number>('JWT_REFRESH_TTL')!;
    const permissionKeys = await this.permissions.effectivePermissions(user.id);

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        // Fase 10.2 item 7/48: claim ASSINADA pelo servidor — o front confia
        // nela sem round-trip extra, mas não pode forjá-la (exigiria o
        // segredo JWT_ACCESS_SECRET, que só o servidor conhece).
        permissions: permissionKeys,
      },
      { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: accessTtl },
    );

    const refreshRaw = randomBytes(48).toString('hex');
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: this.sha256(refreshRaw).slice(0, 16), typ: 'refresh' },
      { secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.sha256(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  async login(
    email: string,
    password: string,
    meta?: Record<string, unknown>,
    throttleKey?: string,
  ): Promise<{ user: AuthUser; tokens: AuthTokens; mustChangePassword: boolean }> {
    const user = await this.validateUser(email, password, throttleKey);
    const tokens = await this.issueTokens(user);
    const fresh = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: { mustChangePassword: true },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.id,
      userNameSnapshot: user.name,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      metadata: meta,
    });
    return { user, tokens, mustChangePassword: fresh.mustChangePassword };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido.');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Token não é de refresh.');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.sha256(refreshToken) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    // Rotação: revoga o token usado e emite novos.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Usuário inativo.');
    }
    return this.issueTokens(this.toAuthUser(user));
  }

  async logout(refreshToken: string, user: AuthUser): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.id,
      userNameSnapshot: user.name,
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: user.id,
    });
  }

  /**
   * Item 2/26 da Fase 10.2 — bootstrap seguro do primeiro usuário (OWNER).
   * Só funciona quando NÃO existe nenhum usuário em nenhuma organização —
   * uma vez que o primeiro exista, este endpoint sempre nega (é a proteção
   * contra alguém recriar um OWNER depois que o sistema já está em uso).
   * Nenhuma senha fica gravada no código-fonte: quem chama fornece a senha.
   */
  async bootstrap(
    organizationName: string,
    name: string,
    email: string,
    password: string,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const existingUsers = await this.prisma.user.count();
    if (existingUsers > 0) {
      throw new ForbiddenException('O sistema já tem usuários — o bootstrap inicial só roda uma vez.');
    }
    if (password.length < 8) {
      throw new BadRequestException('A senha deve ter ao menos 8 caracteres.');
    }

    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await argon2.hash(password);
    const created = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: organizationName, status: EntityStatus.ACTIVE },
      });
      await seedPermissionsAndRoles(tx as any, org.id);
      const ownerRole = await tx.appRole.findUniqueOrThrow({
        where: { organizationId_key: { organizationId: org.id, key: 'OWNER' } },
      });
      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          name,
          email: normalizedEmail,
          passwordHash,
          role: Role.OWNER,
          appRoleId: ownerRole.id,
          status: EntityStatus.ACTIVE,
        },
      });
      return user;
    });

    const authUser = this.toAuthUser(created);
    const tokens = await this.issueTokens(authUser);
    await this.audit.record({
      organizationId: authUser.organizationId,
      userId: authUser.id,
      userNameSnapshot: authUser.name,
      action: AuditAction.BOOTSTRAP_OWNER,
      entityType: 'User',
      entityId: authUser.id,
      after: { email: authUser.email, organizationName },
    });
    return { user: authUser, tokens };
  }

  /** item 25 — troca de senha pelo próprio usuário. Nunca expõe a senha antiga. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Senha atual incorreta.');
    if (newPassword.length < 8) throw new BadRequestException('A nova senha deve ter ao menos 8 caracteres.');
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, updatedBy: userId },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      userId,
      userNameSnapshot: user.name,
      action: AuditAction.PASSWORD_CHANGE,
      entityType: 'User',
      entityId: userId,
    });
  }

  /**
   * item 25 — administrador redefine a senha de um colaborador. Gera uma
   * senha temporária aleatória (nunca escolhida por quem chama, nunca a
   * senha anterior) e força troca no próximo login. Retorna a senha em
   * texto plano UMA vez, só nesta resposta — não fica salva em lugar
   * nenhum além do hash.
   */
  async resetPassword(actorId: string, actorOrganizationId: string, targetUserId: string): Promise<string> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId: actorOrganizationId },
    });
    if (!target) throw new BadRequestException('Usuário não encontrado nesta organização.');
    if (target.role === Role.OWNER && target.id !== actorId) {
      throw new ForbiddenException('Não é possível redefinir a senha do Proprietário por esta rota.');
    }
    const tempPassword = randomBytes(9).toString('base64url'); // 12 chars, alfanumérico seguro
    const passwordHash = await argon2.hash(tempPassword);
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { passwordHash, mustChangePassword: true, updatedBy: actorId },
    });
    await this.audit.record({
      organizationId: actorOrganizationId,
      userId: actorId,
      action: AuditAction.PASSWORD_RESET,
      entityType: 'User',
      entityId: targetUserId,
    });
    return tempPassword;
  }
}
