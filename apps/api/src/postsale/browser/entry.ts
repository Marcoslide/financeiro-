/**
 * Entry do bundle de navegador do módulo Pós-venda (protótipo standalone).
 * Expõe o MESMO parser do sistema (parseFile) para os 3 relatórios e a
 * classificação financeira determinística. Processamento 100% local.
 */
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { parsePostSale, PostSaleType } from '../parsing/postsale-rows';
import { classifyExposureNumbers, EXPOSURE_METHODOLOGY } from '../exposure';

(globalThis as unknown as { PosVenda: unknown }).PosVenda = {
  parse: (ab: ArrayBuffer, filename: string, type: PostSaleType) =>
    parsePostSale(Buffer.from(new Uint8Array(ab)), filename, type),
  classify: (status: string | null, requested: number, compensation: number) =>
    classifyExposureNumbers(status, requested || 0, compensation || 0),
  methodology: EXPOSURE_METHODOLOGY,
};
