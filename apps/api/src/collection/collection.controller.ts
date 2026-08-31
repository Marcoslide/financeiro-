import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import { AuthUser } from '@financeiro/shared';
import { Response } from 'express';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { CollectionService } from './collection.service';
import {
  CreateOperationalLocationDto,
  CreateScanStationDto,
  ListShipmentScansDto,
  RegisterShipmentScanDto,
} from './dto';

@Controller('collection')
export class CollectionController {
  constructor(private readonly collection: CollectionService) {}

  @Get('locations')
  @RequirePermission('expedition.view')
  locations(@CurrentUser() user: AuthUser) {
    return this.collection.listLocations(user.organizationId);
  }

  @Post('locations')
  @RequirePermission('settings.manage')
  createLocation(@CurrentUser() user: AuthUser, @Body() dto: CreateOperationalLocationDto) {
    return this.collection.createLocation(user, dto);
  }

  @Post('locations/:locationId/stations')
  @RequirePermission('settings.manage')
  createStation(
    @CurrentUser() user: AuthUser,
    @Param('locationId') locationId: string,
    @Body() dto: CreateScanStationDto,
  ) {
    return this.collection.createStation(user, locationId, dto);
  }

  @Post('scans')
  @RequirePermission('expedition.execute')
  scan(@CurrentUser() user: AuthUser, @Body() dto: RegisterShipmentScanDto) {
    return this.collection.registerScan(user, dto);
  }

  @Get('scans')
  @RequirePermission('expedition.view')
  scans(@CurrentUser() user: AuthUser, @Query() query: ListShipmentScansDto) {
    return this.collection.listScans(user.organizationId, query);
  }

  @Get('summary')
  @RequirePermission('expedition.view')
  summary(@CurrentUser() user: AuthUser, @Query() query: ListShipmentScansDto) {
    return this.collection.summary(user.organizationId, query);
  }

  @Get('export.xlsx')
  @RequirePermission('expedition.view')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async export(
    @CurrentUser() user: AuthUser,
    @Query() query: ListShipmentScansDto,
    @Res() response: Response,
  ) {
    const workbook = await this.collection.exportWorkbook(user.organizationId, query);
    const date = new Date().toISOString().slice(0, 10);
    response.setHeader('Content-Disposition', `attachment; filename="coleta-rastro-${date}.xlsx"`);
    response.send(workbook);
  }
}
