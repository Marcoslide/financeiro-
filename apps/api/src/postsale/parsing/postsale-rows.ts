import { ReportType } from '@financeiro/shared';
import { parseFile, ParsedFile } from '../../imports/parsing';
import { RowAccessor } from '../../imports/parsing/row-accessor';
import { cleanId, parseDate, parseDecimal, parseIntSafe } from '../../imports/parsing/value-parsers';

/**
 * Extrai as linhas dos três relatórios de pós-venda REUSANDO o parser do Bloco 2
 * (detecção de formato, cabeçalho e leitura de células). NÃO reimplementa parser.
 * Produz linhas "planas" que o serviço agrupa em Pedido/Ocorrência/Item.
 *
 * Regra multi-SKU (§6): os campos financeiros da OCORRÊNCIA (reembolso solicitado,
 * compensação) são lidos por linha, mas pertencem à ocorrência — o serviço os
 * contabiliza UMA vez por ocorrência, nunca somando as linhas.
 */

export type PostSaleType = 'RETURN_REFUND' | 'ORDER_CANCELLATION' | 'FAILED_DELIVERY';

const REPORT_OF: Record<PostSaleType, ReportType> = {
  RETURN_REFUND: ReportType.RETURN_REFUND,
  ORDER_CANCELLATION: ReportType.ORDER_CANCELLATION,
  FAILED_DELIVERY: ReportType.FAILED_DELIVERY,
};

export interface PostSaleRow {
  physicalRowNumber: number;
  orderId: string | null;
  returnId: string | null;
  /** chave natural da ocorrência (returnId p/ devolução; orderId p/ cancel/falha). */
  occurrenceKey: string | null;
  status: string | null;
  reason: string | null;
  reasonRevised: string | null;
  resolution: string | null;
  returnType: string | null;
  disputeReason: string | null;
  sellerNote: string | null;
  sellerActionDeadline: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
  orderStatus: string | null;
  uf: string | null;
  city: string | null;
  shippingOption: string | null;
  stockType: string | null;
  paymentMethod: string | null;
  occurredAt: Date | null;
  orderCreatedAt: Date | null;
  // financeiro no nível da OCORRÊNCIA (repetido por linha)
  requestedRefundAmount: string | null;
  sellerCompensationAmount: string | null;
  buyerPaidAmount: string | null;
  // item (nível SKU)
  sku: string | null;
  parentSku: string | null;
  productName: string | null;
  variationName: string | null;
  quantity: number | null;
  unitPrice: string | null;
  rawPayload: Record<string, string>;
}

export interface ParsedPostSale {
  parsed: ParsedFile;
  rows: PostSaleRow[];
  headerRowIndex: number | null;
  sheetName: string | null;
  physicalRowCount: number;
  dataRowCount: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  notRecognized: boolean;
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
function id(acc: RowAccessor, labels: string[]): string | null {
  for (const l of labels) {
    if (!acc.has(l)) continue;
    const v = cleanId(acc.get(l));
    if (v) return v;
  }
  return null;
}

export function parsePostSale(buffer: Buffer, filename: string, type: PostSaleType): ParsedPostSale {
  const parsed = parseFile(buffer, filename, REPORT_OF[type]);
  const base: ParsedPostSale = {
    parsed,
    rows: [],
    headerRowIndex: parsed.headerRowIndex,
    sheetName: parsed.sheetName,
    physicalRowCount: parsed.physicalRowCount,
    dataRowCount: parsed.dataRows.length,
    periodStart: null,
    periodEnd: null,
    notRecognized: !parsed.spec || parsed.reportType === ReportType.UNKNOWN,
  };
  if (base.notRecognized) return base;

  const rows: PostSaleRow[] = [];
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  for (const dr of parsed.dataRows) {
    const acc = new RowAccessor(dr.headerNames, dr.cells);
    const raw: Record<string, string> = {};
    dr.headerNames.forEach((h, i) => { if (h) raw[h] = dr.values[i] ?? ''; });

    const orderId = id(acc, ['ID do pedido']);
    const returnId = id(acc, ['ID da Devolução']);
    const occurrenceKey = type === 'RETURN_REFUND' ? (returnId ?? orderId) : orderId;

    const orderCreatedAt = firstDate(acc, ['Data de criação do pedido']);
    const occurredAt =
      type === 'RETURN_REFUND'
        ? orderCreatedAt
        : firstDate(acc, ['Data da Finalização do Cancelamento', 'Data de criação do pedido']);
    if (occurredAt) {
      if (!periodStart || occurredAt < periodStart) periodStart = occurredAt;
      if (!periodEnd || occurredAt > periodEnd) periodEnd = occurredAt;
    }

    rows.push({
      physicalRowNumber: dr.physicalRowNumber,
      orderId,
      returnId,
      occurrenceKey,
      status: first(acc, ['Status da Devolução / Reembolso', 'Status do pedido']),
      reason: first(acc, ['Motivo da Devolução', 'Cancelar Motivo']),
      reasonRevised: first(acc, ['Motivo da devolução revisado']),
      resolution: first(acc, ['Solução para Retorno e Reembolso']),
      returnType: first(acc, ['Tipo de Devolução']),
      disputeReason: first(acc, ['Motivo da disputa']),
      sellerNote: first(acc, ['Observação do vendedor', 'Observação do Comprador']),
      sellerActionDeadline: first(acc, ['Ação do Vendedor solicitada até']),
      trackingNumber: first(acc, ['Número de rastreamento de devolução', 'Número de rastreamento', 'Número de rastreio']),
      trackingStatus: first(acc, ['Status de rastreamento de devolução']),
      orderStatus: first(acc, ['Status do pedido']),
      uf: first(acc, ['UF', 'Estado']),
      city: first(acc, ['Cidade']),
      shippingOption: first(acc, ['Opção de envio', 'Opção de Entrega', 'Opção de envio de devolução']),
      stockType: first(acc, ['Tipo de Estoque']),
      paymentMethod: first(acc, ['Método de pagamento']),
      occurredAt,
      orderCreatedAt,
      requestedRefundAmount: dec(acc, ['Quantia total de reembolsos']),
      sellerCompensationAmount: dec(acc, ['Compensação ao Vendedor (Disputa bem sucedida/Ajuste em carteira)']),
      buyerPaidAmount: dec(acc, ['Valor pago pelo comprador', 'Valor Total']),
      sku: first(acc, ['SKU da Variação', 'Número de referência SKU']),
      parentSku: first(acc, ['SKU principal', 'Nº de referência do SKU principal']),
      productName: first(acc, ['Nome do Produto']),
      variationName: first(acc, ['Nome da variação']),
      quantity: intv(acc, ['Quantidade de Devoluções', 'Quantidade']),
      unitPrice: dec(acc, ['Preço da unidade', 'Preço acordado', 'Preço original']),
      rawPayload: raw,
    });
  }

  return { ...base, rows, periodStart, periodEnd };
}
