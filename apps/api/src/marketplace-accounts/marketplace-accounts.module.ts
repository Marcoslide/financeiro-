import { Module } from '@nestjs/common';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { MarketplaceAccountsController } from './marketplace-accounts.controller';

@Module({
  providers: [MarketplaceAccountsService],
  controllers: [MarketplaceAccountsController],
  exports: [MarketplaceAccountsService],
})
export class MarketplaceAccountsModule {}
