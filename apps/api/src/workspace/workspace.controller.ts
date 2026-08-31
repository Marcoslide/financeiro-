import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { AuthUser } from '@financeiro/shared';
import { CurrentUser } from '../common/decorators';
import { PatchWorkspaceStoreDto } from './dto';
import { WorkspaceService } from './workspace.service';

@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  /** Todas as respostas são obrigatoriamente escopadas à organização do JWT. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.workspace.list(user.organizationId);
  }

  @Get('versions')
  versions(@CurrentUser() user: AuthUser) {
    return this.workspace.versions(user.organizationId);
  }

  @Get(':storeName')
  get(@CurrentUser() user: AuthUser, @Param('storeName') storeName: string) {
    return this.workspace.get(user.organizationId, storeName);
  }

  @Patch(':storeName')
  patch(
    @CurrentUser() user: AuthUser,
    @Param('storeName') storeName: string,
    @Body() dto: PatchWorkspaceStoreDto,
  ) {
    return this.workspace.patch(user.organizationId, user.id, storeName, dto);
  }
}
