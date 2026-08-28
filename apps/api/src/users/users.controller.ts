import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role, AuthUser } from '@financeiro/shared';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { CurrentUser, Roles, RequirePermission } from '../common/decorators';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** item 34 — só quem tem users.view enxerga a lista (menu E rota, não só o botão). */
  @Get()
  @RequirePermission('users.view')
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(user.organizationId);
  }

  @Post()
  @Roles(Role.ADMIN)
  @RequirePermission('users.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(user.organizationId, user.id, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @RequirePermission('users.edit')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(user.organizationId, user.id, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @RequirePermission('users.disable')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.deactivate(user.organizationId, user.id, id);
  }
}
