/**
 * Entry do bundle de navegador do módulo Pedidos (protótipo standalone).
 * Expõe o MESMO parser de pedidos (parseFile/ORDERS) e as regras determinísticas
 * de status e financeiro. Processamento 100% local.
 */
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { parseOrders } from '../parsing/orders-rows';
import { normalizeOrderStatus, NORMALIZED_LABELS, ORDER_TABS } from '../status';
import { computeOrderFinance, OrderFinanceInput } from '../finance';

(globalThis as unknown as { Pedidos: unknown }).Pedidos = {
  parse: (ab: ArrayBuffer, filename: string) => parseOrders(Buffer.from(new Uint8Array(ab)), filename),
  normalizeStatus: (s: string | null) => normalizeOrderStatus(s),
  labels: NORMALIZED_LABELS,
  tabs: ORDER_TABS,
  computeFinance: (input: OrderFinanceInput) => computeOrderFinance(input),
};
