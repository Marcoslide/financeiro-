/**
 * Entry ÚNICO do sistema completo (protótipo standalone). Expõe os MESMOS parsers
 * e regras determinísticas do backend para TODOS os módulos — Produtos, Pedidos e
 * Pós-venda — além da normalização de status e do cálculo financeiro do pedido.
 * Processamento 100% local (IndexedDB); nenhum dado sai do navegador.
 */
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { parseProductSheet } from '../products/parsing/product-sheet';
import { parseOrders } from '../orders/parsing/orders-rows';
import { normalizeOrderStatus, NORMALIZED_LABELS, ORDER_TABS } from '../orders/status';
import { computeOrderFinance, OrderFinanceInput } from '../orders/finance';
import { parsePostSale, PostSaleType } from '../postsale/parsing/postsale-rows';
import { classifyExposureNumbers, EXPOSURE_METHODOLOGY } from '../postsale/exposure';

const toBuf = (ab: ArrayBuffer) => Buffer.from(new Uint8Array(ab));

(globalThis as unknown as { SISTEMA: unknown }).SISTEMA = {
  produtos: {
    parse: (ab: ArrayBuffer, filename: string) => parseProductSheet(toBuf(ab), filename),
  },
  pedidos: {
    parse: (ab: ArrayBuffer, filename: string) => parseOrders(toBuf(ab), filename),
    normalizeStatus: (s: string | null) => normalizeOrderStatus(s),
    labels: NORMALIZED_LABELS,
    tabs: ORDER_TABS,
    computeFinance: (input: OrderFinanceInput) => computeOrderFinance(input),
  },
  posVenda: {
    parse: (ab: ArrayBuffer, filename: string, type: PostSaleType) => parsePostSale(toBuf(ab), filename, type),
    classify: (status: string | null, requested: number, compensation: number) =>
      classifyExposureNumbers(status, requested || 0, compensation || 0),
    methodology: EXPOSURE_METHODOLOGY,
  },
};
