import { Module } from '@nestjs/common';
import { PostSaleService } from './postsale.service';
import { PostSaleController } from './postsale.controller';
import { FILE_STORAGE, LocalDiskStorage } from '../imports/storage';

@Module({
  providers: [PostSaleService, { provide: FILE_STORAGE, useClass: LocalDiskStorage }],
  controllers: [PostSaleController],
  exports: [PostSaleService],
})
export class PostSaleModule {}
