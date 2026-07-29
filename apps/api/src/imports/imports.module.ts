import { Module } from '@nestjs/common';
import { ImportsService } from './imports.service';
import { ImportsController } from './imports.controller';
import { FILE_STORAGE, LocalDiskStorage } from './storage';

@Module({
  providers: [ImportsService, { provide: FILE_STORAGE, useClass: LocalDiskStorage }],
  controllers: [ImportsController],
  exports: [ImportsService],
})
export class ImportsModule {}
