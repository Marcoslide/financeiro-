import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MarketplaceAccountsModule } from './marketplace-accounts/marketplace-accounts.module';
import { ImportsModule } from './imports/imports.module';
import { ProductsModule } from './products/products.module';
import { PostSaleModule } from './postsale/postsale.module';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { RolesGuard } from './common/roles.guard';
import { TenantGuard } from './common/tenant.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    MarketplaceAccountsModule,
    ImportsModule,
    ProductsModule,
    PostSaleModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordem importa: autentica → resolve tenant → autoriza por papel.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
