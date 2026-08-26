import { ReportType } from '@financeiro/shared';
import { parseFile, ParsedFile } from '../../imports/parsing';
import { RowAccessor } from '../../imports/parsing/row-accessor';
import { cleanId, parseDate, parseDecimal, parseIntSafe } from '../../imports/parsing/value-parsers';

/**
 * Extrai as linhas do relatório de PEDIDOS (Order.all…) REUSANDO o parser do Bloco 2
 * (detecção de formato/cabeçalho/leitura de células) — não reimplementa parser.
 * Cada linha é um ITEM; o serviço agrupa por "ID do pedido" em Pedido + Itens (§15).
 *
 * Cabeçalhos DUPLICADOS (§19): "Desconto do vendedor" (2×) e "Cidade" (2×) são
 * lidos por POSIÇÃO (ocorrência n) e preservados separadamente (seller_discount_1/2,
 * city_1/2), com o cabeçalho bruto guardado para auditoria.
 */

export interface OrderItemRow {
  physicalRowNumber: number;
  lineIndex: number;
  orderId: string | null;

  // Pedido (repetido por linha; o serviço persiste uma vez — §17)
  orderStatus: string | null;
  cancelReason: string | null;
  returnRefundStatus: string | null;
  trackingNumber: string | null;
  shippingOption: string | null;
  shippingMethod: string | null;
  isFbs: string | null;
  orderCreatedAt: Date | null;
  paidAt: Date | null;
  shipByDate: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;

  totalAmount: string | null;
  buyerPaidShipping: string | null;
  reverseShippingFee: string | null;
  transactionFee: string | null;
  commissionGross: string | null;
  commissionNet: string | null;
  serviceFeeGross: string | null;
  serviceFeeNet: string | null;
  grandTotal: string | null;
  estimatedShipping: string | null;
  unitsTotal: number | null;

  // PII (nunca vai para LLM)
  buyerUsername: string | null;
  recipientName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  uf: string | null;
  country: string | null;
  cep: string | null;
  buyerNote: string | null;
  note: string | null;

  // Item
  productName: string | null;
  sku: string | null;
  mainSkuRef: string | null;
  variationName: string | null;
  originalPrice: string | null;
  agreedPrice: string | null;
  quantity: number | null;
  productSubtotal: string | null;
  sellerDiscount1: string | null;
  sellerDiscount2: string | null;
  weightSku: string | null;

  // Ajustes do pedido (PROMPT "Correção da composição financeira por pedido"): descontos/incentivos
  // aplicados pela própria Shopee no pedido, já presentes no Order.all — usados como Venda Bruta →
  // Ajustes → Receita Ajustada (nunca confundidos com as Taxas Shopee, que vêm do Income). Repetem-se
  // idênticos em toda linha de um pedido multi-item (mesmo padrão de totalAmount/grandTotal — nível
  // pedido, não nível item), confirmado com dados reais antes de adicionar estes campos.
  pixAdjustment: string | null;
  coupon: string | null;
  couponIncentive: string | null;
  commercialActionIncentive: string | null;
  commercialActionAdjustment: string | null;
  levemaisShopeeDiscount: string | null;
  levemaisSellerDiscount: string | null;

  rawPayload: Record<string, string>;
}

export interface ParsedOrders {
  parsed: ParsedFile;
  rows: OrderItemRow[];
  headerRowIndex: number | null;
  sheetName: string | null;
  physicalRowCount: number;
  dataRowCount: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  notRecognized: boolean;
  fileHash: string;
}

function first(acc: RowAccessor, labels: string[]): string | null {
  for (const l of labels) {
    const v = acc.get(l);
    if (v != null && v.trim() !== '') return v.trim();
  }
  return null;
}
function firstDate(acc: RowAccessor, labels: string[]): Date | null {
  for (const l of labels) {
    if (!acc.has(l)) continue;
    const p = parseDate(acc.get(l), acc.getRaw(l));
    if (p.date) return p.date;
  }
  return null;
}
function dec(acc: RowAccessor, labels: string[]): string | null {
  for (const l of labels) {
    if (!acc.has(l)) continue;
    const p = parseDecimal(acc.get(l));
    if (p.decimal != null) return p.decimal;
  }
  return null;
}
function intv(acc: RowAccessor, labels: string[]): number | null {
  for (const l of labels) {
    if (!acc.has(l)) continue;
    const n = parseIntSafe(acc.get(l));
    if (n != null) return n;
  }
  return null;
}

/** Valor de texto da n-ésima (0-based) ocorrência de um cabeçalho — para duplicados (§19). */
function nthText(headerNames: string[], values: string[], label: string, occurrence: number): string | null {
  let seen = -1;
  for (let i = 0; i < headerNames.length; i++) {
    if ((headerNames[i] ?? '').trim() === label) {
      seen++;
      if (seen === occurrence) {
        const v = (values[i] ?? '').toString().trim();
        return v === '' ? null : v;
      }
    }
  }
  return null;
}
function nthDec(headerNames: string[], values: string[], label: string, occurrence: number): string | null {
  const t = nthText(headerNames, values, label, occurrence);
  if (t == null) return null;
  return parseDecimal(t).decimal;
}

export function parseOrders(buffer: Buffer, filename: string): ParsedOrders {
  const parsed = parseFile(buffer, filename, ReportType.ORDERS);
  const base: ParsedOrders = {
    parsed,
    rows: [],
    headerRowIndex: parsed.headerRowIndex,
    sheetName: parsed.sheetName,
    physicalRowCount: parsed.physicalRowCount,
    dataRowCount: parsed.dataRows.length,
    periodStart: null,
    periodEnd: null,
    notRecognized: !parsed.spec || parsed.reportType === ReportType.UNKNOWN,
    fileHash: parsed.fileHash,
  };
  if (base.notRecognized) return base;

  const rows: OrderItemRow[] = [];
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let lineIndex = 0;

  for (const dr of parsed.dataRows) {
    const acc = new RowAccessor(dr.headerNames, dr.cells);
    const raw: Record<string, string> = {};
    // Preserva TODOS os cabeçalhos, inclusive duplicados (sufixo posicional).
    const counts: Record<string, number> = {};
    dr.headerNames.forEach((h, i) => {
      if (!h) return;
      const n = (counts[h] = (counts[h] ?? 0) + 1);
      const keyName = n > 1 ? `${h} (${n})` : h;
      raw[keyName] = dr.values[i] ?? '';
    });

    const orderId = id(acc, dr, ['ID do pedido']);
    const orderCreatedAt = firstDate(acc, ['Data de criação do pedido']);
    if (orderCreatedAt) {
      if (!periodStart || orderCreatedAt < periodStart) periodStart = orderCreatedAt;
      if (!periodEnd || orderCreatedAt > periodEnd) periodEnd = orderCreatedAt;
    }

    rows.push({
      physicalRowNumber: dr.physicalRowNumber,
      lineIndex: lineIndex++,
      orderId,
      orderStatus: first(acc, ['Status do pedido']),
      cancelReason: first(acc, ['Cancelar Motivo']),
      returnRefundStatus: first(acc, ['Status da Devolução / Reembolso']),
      trackingNumber: first(acc, ['Número de rastreamento']),
      shippingOption: first(acc, ['Opção de envio']),
      shippingMethod: first(acc, ['Método de envio']),
      isFbs: first(acc, ['Pedido FBS']),
      orderCreatedAt,
      paidAt: firstDate(acc, ['Hora do pagamento do pedido']),
      shipByDate: firstDate(acc, ['Data prevista de envio']),
      shippedAt: firstDate(acc, ['Tempo de Envio']),
      deliveredAt: firstDate(acc, ['Domestic Delivered Date']),
      completedAt: firstDate(acc, ['Hora completa do pedido']),
      cancelledAt: firstDate(acc, ['Data da Finalização do Cancelamento']),

      totalAmount: dec(acc, ['Valor Total']),
      buyerPaidShipping: dec(acc, ['Taxa de envio pagas pelo comprador']),
      reverseShippingFee: dec(acc, ['Taxa de Envio Reversa']),
      transactionFee: dec(acc, ['Taxa de transação']),
      commissionGross: dec(acc, ['Taxa de comissão bruta']),
      commissionNet: dec(acc, ['Taxa de comissão líquida']),
      serviceFeeGross: dec(acc, ['Taxa de serviço bruta']),
      serviceFeeNet: dec(acc, ['Taxa de serviço líquida']),
      grandTotal: dec(acc, ['Total global']),
      estimatedShipping: dec(acc, ['Valor estimado do frete']),
      unitsTotal: intv(acc, ['Número de produtos pedidos']),

      buyerUsername: first(acc, ['Nome de usuário (comprador)', 'Nome de usuário (Comprador)']),
      recipientName: first(acc, ['Nome do destinatário']),
      phone: first(acc, ['Telefone']),
      address: first(acc, ['Endereço de entrega']),
      city: nthText(dr.headerNames, dr.values, 'Cidade', 0),
      district: first(acc, ['Bairro']),
      uf: first(acc, ['UF']),
      country: first(acc, ['País']),
      cep: first(acc, ['CEP']),
      buyerNote: first(acc, ['Observação do comprador']),
      note: first(acc, ['Nota']),

      productName: first(acc, ['Nome do Produto']),
      sku: first(acc, ['Número de referência SKU']),
      mainSkuRef: first(acc, ['Nº de referência do SKU principal']),
      variationName: first(acc, ['Nome da variação']),
      originalPrice: dec(acc, ['Preço original']),
      agreedPrice: dec(acc, ['Preço acordado']),
      quantity: intv(acc, ['Quantidade']),
      productSubtotal: dec(acc, ['Subtotal do produto']),
      sellerDiscount1: nthDec(dr.headerNames, dr.values, 'Desconto do vendedor', 0),
      sellerDiscount2: nthDec(dr.headerNames, dr.values, 'Desconto do vendedor', 1),
      weightSku: dec(acc, ['Peso total SKU']),

      pixAdjustment: dec(acc, ['Ajuste por pagamento via PIX']),
      coupon: dec(acc, ['Cupom']),
      couponIncentive: dec(acc, ['Incentivo de cupom']),
      commercialActionIncentive: dec(acc, ['Incentivo Shopee para ação comercial']),
      commercialActionAdjustment: dec(acc, ['Ajuste por participação em ação comercial']),
      levemaisShopeeDiscount: dec(acc, ['Desconto Shopee da Leve Mais por Menos']),
      levemaisSellerDiscount: dec(acc, ['Desconto da Leve Mais por Menos do vendedor']),

      rawPayload: raw,
    });
  }

  return { ...base, rows, periodStart, periodEnd };
}

function id(acc: RowAccessor, _dr: unknown, labels: string[]): string | null {
  for (const l of labels) {
    if (!acc.has(l)) continue;
    const v = cleanId(acc.get(l));
    if (v) return v;
  }
  return null;
}
