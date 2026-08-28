import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role, AuthUser } from '@financeiro/shared';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto } from './dto';
import { CurrentUser, Roles as RequireRole, RequirePermission } from '../common/decorators';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** item 10 — catálogo de permissões, agrupado por módulo, pra montar a tela de checkboxes. */
  @Get('permissions-catalog')
  @RequirePermission('roles.view')
  catalog() {
    return this.roles.listPermissionCatalog();
  }

  @Get()
  @RequirePermission('roles.view')
  list(@CurrentUser() user: AuthUser) {
    return this.roles.list(user.organizationId);
  }

  @Post()
  @RequireRole(Role.ADMIN)
  @RequirePermission('roles.edit')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(user.organizationId, user.id, dto);
  }

  @Patch(':id')
  @RequireRole(Role.ADMIN)
  @RequirePermission('roles.edit')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(user.organizationId, user.id, id, dto);
  }
}
