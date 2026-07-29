import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { AuthUser } from '@financeiro/shared';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto';
import { CurrentUser, Public } from '../common/decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const meta = { ip: req.ip, userAgent: req.headers?.['user-agent'] };
    const { user, tokens } = await this.auth.login(dto.email, dto.password, meta);
    return { user, ...tokens };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @CurrentUser() user: AuthUser) {
    await this.auth.logout(dto.refreshToken, user);
  }

  /** Dados do usuário autenticado. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
