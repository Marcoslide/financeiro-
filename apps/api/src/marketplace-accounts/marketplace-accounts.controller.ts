import { Controller, Get, Param } from '@nestjs/common';
import { AuthUser } from '@financeiro/shared';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { CurrentUser } from '../common/decorators';

@Controller('marketplace-accounts')
export class MarketplaceAccountsController {
  constructor(private readonly accounts: MarketplaceAccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.accounts.list(user.organizationId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accounts.get(user.organizationId, id);
  }
}
