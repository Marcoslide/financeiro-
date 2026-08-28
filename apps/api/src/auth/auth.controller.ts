import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthUser, Role } from '@financeiro/shared';
import { AuthService, AuthTokens } from './auth.service';
import { PermissionsService } from './permissions.service';
import { LoginDto, RefreshDto, BootstrapDto, ChangePasswordDto } from './dto';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

const REFRESH_COOKIE = 'refresh_token';
// Fase 10.2: cookie httpOnly pro refresh (nunca localStorage — item 4). Sem
// `secure` marcado por padrão porque o teste de amanhã é rede local em HTTP
// puro (Secure exige HTTPS); em produção com domínio HTTPS, setar
// COOKIE_SECURE=true no ambiente.
function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: maxAgeMs,
    path: '/api/auth',
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private setRefreshCookie(res: Response, tokens: AuthTokens): void {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOpts(14 * 24 * 60 * 60 * 1000));
  }

  /** item 2 — permite ao front saber se ainda não existe NENHUM usuário
   * (mostra "Criar conta do Proprietário" em vez do formulário de login). */
  @Public()
  @Get('bootstrap/status')
  async bootstrapStatus() {
    const count = await this.prisma.user.count();
    return { needsBootstrap: count === 0 };
  }

  @Public()
  @Post('bootstrap')
  @HttpCode(200)
  async bootstrap(@Body() dto: BootstrapDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.bootstrap(dto.organizationName, dto.name, dto.email, dto.password);
    this.setRefreshCookie(res, tokens);
    return { user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, mustChangePassword: false };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const meta = { ip: req.ip, userAgent: req.headers?.['user-agent'] };
    const throttleKey = `${dto.email.toLowerCase()}:${req.ip}`;
    const { user, tokens, mustChangePassword } = await this.auth.login(dto.email, dto.password, meta, throttleKey);
    this.setRefreshCookie(res, tokens);
    return { user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, mustChangePassword };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    if (!token) throw new UnauthorizedException('Sessão ausente.');
    const tokens = await this.auth.refresh(token);
    this.setRefreshCookie(res, tokens);
    return tokens;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser,
  ) {
    const token = dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    if (token) await this.auth.logout(token, user);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  /** Dados do usuário autenticado + permissões efetivas (frescas, sem depender só do JWT). */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const permissions = await this.permissions.effectivePermissions(user.id);
    return { ...user, permissions };
  }

  /** item 25 — trocar a própria senha. */
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  /**
   * item 25 — administrador redefine a senha de um colaborador. Retorna a
   * senha temporária em texto plano UMA vez, só nesta resposta (item 24:
   * nunca fica salva em nenhum lugar além do hash) — o front deve exibi-la
   * de forma óbvia como "mostre isso ao colaborador agora, não vai aparecer
   * de novo" e marcar troca obrigatória no próximo login.
   */
  @Post('users/:userId/reset-password')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  async resetPassword(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    const tempPassword = await this.auth.resetPassword(user.id, user.organizationId, userId);
    return { tempPassword };
  }
}
