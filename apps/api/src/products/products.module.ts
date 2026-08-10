import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { FILE_STORAGE, LocalDiskStorage } from '../imports/storage';

@Module({
  providers: [ProductsService, { provide: FILE_STORAGE, useClass: LocalDiskStorage }],
  controllers: [ProductsController],
  exports: [ProductsService],
})
export class ProductsModule {}
