import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, Role } from '@financeiro/shared';
import { ProductsService } from './products.service';
import { CurrentUser, Roles } from '../common/decorators';
import {
  ClassifyVariationsDto,
  CreateFamilyDto,
  ImportProductsDto,
  ListFamiliesQueryDto,
  ListProductBatchesQueryDto,
  ListProductsQueryDto,
  ProductStatsQueryDto,
  UpdateFamilyDto,
  UpdateVariationDto,
} from './dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // --- Leitura (inclusive VIEWER) ---
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListProductsQueryDto) {
    return this.products.listProducts(user.organizationId, query.marketplaceAccountId, {
      search: query.search,
      familyId: query.familyId,
      family: query.family,
      closingPrice: query.closingPrice,
      page: query.page ? parseInt(query.page, 10) : 1,
    });
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser, @Query() query: ProductStatsQueryDto) {
    return this.products.productStats(user.organizationId, query.marketplaceAccountId);
  }

  @Get('families')
  listFamilies(@CurrentUser() user: AuthUser, @Query() query: ListFamiliesQueryDto) {
    return this.products.listFamilies(user.organizationId, query.marketplaceAccountId, query.search);
  }

  @Get('families/:id')
  getFamily(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.getFamily(user.organizationId, id);
  }

  @Get('import-batches')
  listBatches(@CurrentUser() user: AuthUser, @Query() query: ListProductBatchesQueryDto) {
    return this.products.listImportBatches(user.organizationId, query.marketplaceAccountId);
  }

  // --- Escrita (ADMIN/FINANCIAL) ---
  @Post('import')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  import(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImportProductsDto,
    @UploadedFile() file?: { originalname: string; buffer: Buffer; size: number },
  ) {
    return this.products.importCatalog(user.organizationId, user.id, dto.marketplaceAccountId, file);
  }

  @Post('families')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  createFamily(@CurrentUser() user: AuthUser, @Body() dto: CreateFamilyDto) {
    return this.products.createFamily(user.organizationId, user.id, dto);
  }

  @Patch('families/:id')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  updateFamily(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFamilyDto) {
    return this.products.updateFamily(user.organizationId, user.id, id, dto);
  }

  @Post('classify')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  classify(@CurrentUser() user: AuthUser, @Body() dto: ClassifyVariationsDto) {
    return this.products.classifyVariations(user.organizationId, user.id, dto);
  }

  @Patch('variations/:id')
  @Roles(Role.ADMIN, Role.FINANCIAL)
  updateVariation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateVariationDto) {
    return this.products.updateVariation(user.organizationId, user.id, id, dto);
  }
}
