import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, PermissionsService],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, PermissionsService],
})
export class AuthModule {}
