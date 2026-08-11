import { Module } from '@nestjs/common';
import { PostSaleService } from './postsale.service';
import { OccurrenceOpsService } from './occurrence-ops.service';
import { OccurrenceAnalyticsService } from './occurrence-analytics.service';
import { ActionPlanService } from './action-plan.service';
import { PostSaleController } from './postsale.controller';
import { FILE_STORAGE, LocalDiskStorage } from '../imports/storage';

@Module({
  providers: [PostSaleService, OccurrenceOpsService, OccurrenceAnalyticsService, ActionPlanService, { provide: FILE_STORAGE, useClass: LocalDiskStorage }],
  controllers: [PostSaleController],
  exports: [PostSaleService],
})
export class PostSaleModule {}
