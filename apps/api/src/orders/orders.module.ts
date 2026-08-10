import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { FILE_STORAGE, LocalDiskStorage } from '../imports/storage';

/**
 * Módulo PEDIDOS — núcleo transacional (vendas). Importação idempotente (upsert),
 * integração com Produtos (SKU→família→custo, snapshot) e Devoluções (por ID do pedido).
 */
@Module({
  providers: [OrdersService, { provide: FILE_STORAGE, useClass: LocalDiskStorage }],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
