import { Module } from '@nestjs/common';
import { PostSaleService } from './postsale.service';
import { OccurrenceOpsService } from './occurrence-ops.service';
import { PostSaleController } from './postsale.controller';
import { FILE_STORAGE, LocalDiskStorage } from '../imports/storage';

@Module({
  providers: [PostSaleService, OccurrenceOpsService, { provide: FILE_STORAGE, useClass: LocalDiskStorage }],
  controllers: [PostSaleController],
  exports: [PostSaleService],
})
export class PostSaleModule {}
