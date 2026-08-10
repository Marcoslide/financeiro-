import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { PostSaleModule } from '../postsale/postsale.module';

/**
 * Módulo de INTELIGÊNCIA (IA) — camada de análise sobre dados determinísticos.
 * Depende do PostSaleModule para montar evidências (agregados, sem PII).
 * A LLM nunca calcula dinheiro (§40 Pedidos / §44-§57 Devoluções).
 */
@Module({
  imports: [PostSaleModule],
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
