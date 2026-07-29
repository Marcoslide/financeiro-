import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { AuthUser, AuditAction, Role } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
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

  async validateUser(email: string, password: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    return this.toAuthUser(user);
  }

  async issueTokens(user: AuthUser): Promise<AuthTokens> {
    const accessTtl = this.config.get<number>('JWT_ACCESS_TTL')!;
    const refreshTtl = this.config.get<number>('JWT_REFRESH_TTL')!;

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, name: user.name, email: user.email, role: user.role, organizationId: user.organizationId },
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

  async login(email: string, password: string, meta?: Record<string, unknown>): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const user = await this.validateUser(email, password);
    const tokens = await this.issueTokens(user);
    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      metadata: meta,
    });
    return { user, tokens };
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
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: user.id,
    });
  }
}
