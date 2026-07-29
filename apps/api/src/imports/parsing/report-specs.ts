import { ImportIssue, ImportIssueSeverity, ReportType, REPORT_TYPE_LABELS } from '@financeiro/shared';
import { RowAccessor } from './row-accessor';
import { cleanId, parseDate, parseDecimal, parseIntSafe, parsePercent } from './value-parsers';

/** Resultado da normalização de uma linha de dados de um relatório. */
export interface NormalizedRow {
  normalized: Record<string, string | number | boolean | null>;
  identifiers: Record<string, string | null>;
  externalOrderId: string | null;
  externalReference: string | null;
  /** Chave natural documentada (para detectar ATUALIZAÇÃO da mesma entidade). */
  naturalKey: string;
  /** Partes ordenadas que compõem o hash canônico (§9.1 do contrato). */
  canonicalParts: string[];
  issues: ImportIssue[];
  /** Data do evento (para o período coberto pelo lote). */
  eventDate: Date | null;
}

export interface ReportSpec {
  type: ReportType;
  label: string;
  /** Rótulos que DEVEM estar presentes na linha de cabeçalho (assinatura). */
  signature: string[];
  /** Rótulos que NÃO podem estar presentes (desempate entre relatórios afins). */
  antiSignature?: string[];
  /** Confiança máxima quando a assinatura casa 100% (Falha na entrega é ambígua). */
  confidenceCap: number;
  /** Prioridade para desempate quando dois relatórios casam a mesma linha. */
  priority: number;
  normalize(row: RowAccessor): NormalizedRow;
}

// ---------------------------------------------------------------------------
// Helpers de normalização
// ---------------------------------------------------------------------------

function canonicalDecimal(s: string | null): string {
  if (s == null) return '';
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}
function canonicalDate(d: Date | null): string {
  return d ? d.toISOString() : '';
}
function issue(
  code: string,
  severity: ImportIssueSeverity,
  message: string,
  field?: string,
): ImportIssue {
  return { code, severity, message, field };
}

/** Coletor de campos decimais com registro de alertas de parsing. */
class Builder {
  readonly issues: ImportIssue[] = [];
  constructor(private readonly row: RowAccessor) {}

  dec(label: string, occurrence = 0): string | null {
    const p = parseDecimal(this.row.get(label, occurrence));
    if (p.error && this.row.get(label, occurrence).trim() !== '') {
      this.issues.push(issue('DECIMAL_PARSE', ImportIssueSeverity.WARNING, p.error, label));
    }
    return p.decimal;
  }
  pct(label: string): string | null {
    return parsePercent(this.row.get(label)).decimal;
  }
  int(label: string): number | null {
    return parseIntSafe(this.row.get(label));
  }
  date(label: string): Date | null {
    const p = parseDate(this.row.get(label), this.row.getRaw(label));
    if (p.error && this.row.get(label).trim() !== '') {
      this.issues.push(issue('DATE_PARSE', ImportIssueSeverity.WARNING, p.error, label));
    }
    return p.date;
  }
  str(label: string, occurrence = 0): string | null {
    const v = this.row.get(label, occurrence).trim();
    return v === '' ? null : v;
  }
  id(label: string): string | null {
    return cleanId(this.row.get(label));
  }
}

// ---------------------------------------------------------------------------
// Especificações por relatório
// ---------------------------------------------------------------------------

const ordersSpec: ReportSpec = {
  type: ReportType.ORDERS,
  label: REPORT_TYPE_LABELS[ReportType.ORDERS],
  signature: ['ID do pedido', 'Preço acordado', 'Taxa de comissão líquida'],
  confidenceCap: 1,
  priority: 30,
  normalize(row) {
    const b = new Builder(row);
    const orderId = b.id('ID do pedido');
    const variationSku = b.str('Número de referência SKU');
    const status = b.str('Status do pedido');
    const negotiated = b.dec('Preço acordado');
    const original = b.dec('Preço original');
    const subtotal = b.dec('Subtotal do produto');
    const quantity = b.int('Quantidade');
    const buyerPaid = b.dec('Valor Total');
    const commissionNet = b.dec('Taxa de comissão líquida');
    const serviceNet = b.dec('Taxa de serviço líquida');
    const txFee = b.dec('Taxa de transação');
    const globalTotal = b.dec('Total global');
    // "Desconto do vendedor" aparece DUAS vezes — preservamos as duas por posição.
    const sellerDiscount1 = b.dec('Desconto do vendedor', 0);
    const sellerDiscount2 = row.occurrences('Desconto do vendedor') > 1 ? b.dec('Desconto do vendedor', 1) : null;
    const createdAt = b.date('Data de criação do pedido');
    if (!orderId) b.issues.push(issue('MISSING_ID', ImportIssueSeverity.ERROR, 'Linha sem ID do pedido.', 'ID do pedido'));

    const normalized = {
      externalOrderId: orderId,
      status,
      variationSku,
      productName: b.str('Nome do Produto'),
      parentSku: b.str('Nº de referência do SKU principal'),
      originalUnitPrice: original,
      negotiatedUnitPrice: negotiated,
      quantity,
      subtotal,
      sellerDiscount: sellerDiscount1,
      sellerDiscountSecondary: sellerDiscount2,
      buyerPaidAmount: buyerPaid,
      commissionNetFee: commissionNet,
      serviceNetFee: serviceNet,
      transactionFee: txFee,
      estimatedReceivable: globalTotal,
      createdAtMarketplace: createdAt ? createdAt.toISOString() : null,
      isFbs: /sim|yes/i.test(row.get('Pedido FBS')),
    };
    const naturalKey = `${orderId ?? ''}|${variationSku ?? ''}`;
    const canonicalParts = [
      `orderId=${orderId ?? ''}`,
      `sku=${variationSku ?? ''}`,
      `status=${status ?? ''}`,
      `negotiated=${canonicalDecimal(negotiated)}`,
      `subtotal=${canonicalDecimal(subtotal)}`,
      `qty=${quantity ?? ''}`,
      `buyerPaid=${canonicalDecimal(buyerPaid)}`,
      `commissionNet=${canonicalDecimal(commissionNet)}`,
      `globalTotal=${canonicalDecimal(globalTotal)}`,
    ];
    return {
      normalized,
      identifiers: { externalOrderId: orderId, variationSku },
      externalOrderId: orderId,
      externalReference: variationSku,
      naturalKey,
      canonicalParts,
      issues: b.issues,
      eventDate: createdAt,
    };
  },
};

const cancellationSpec: ReportSpec = {
  type: ReportType.ORDER_CANCELLATION,
  label: REPORT_TYPE_LABELS[ReportType.ORDER_CANCELLATION],
  signature: ['ID do pedido', 'Cancelar Motivo'],
  confidenceCap: 1,
  priority: 40, // "Cancelar Motivo" desempata a favor de cancelamento
  normalize(row) {
    const b = new Builder(row);
    const orderId = b.id('ID do pedido');
    const reason = b.str('Cancelar Motivo');
    const status = b.str('Status do pedido');
    const cancelledAt = b.date('Data da Finalização do Cancelamento');
    const createdAt = b.date('Data de criação do pedido');
    if (!orderId) b.issues.push(issue('MISSING_ID', ImportIssueSeverity.ERROR, 'Linha sem ID do pedido.', 'ID do pedido'));
    const naturalKey = orderId ?? '';
    return {
      normalized: {
        externalOrderId: orderId,
        reason,
        status,
        cancelledAt: cancelledAt ? cancelledAt.toISOString() : null,
      },
      identifiers: { externalOrderId: orderId },
      externalOrderId: orderId,
      externalReference: null,
      naturalKey,
      canonicalParts: [
        `orderId=${orderId ?? ''}`,
        `reason=${reason ?? ''}`,
        `status=${status ?? ''}`,
        `cancelledAt=${canonicalDate(cancelledAt)}`,
      ],
      issues: b.issues,
      eventDate: cancelledAt ?? createdAt,
    };
  },
};

const failedDeliverySpec: ReportSpec = {
  type: ReportType.FAILED_DELIVERY,
  label: REPORT_TYPE_LABELS[ReportType.FAILED_DELIVERY],
  // Compartilha quase todo o schema de pedidos. Excluímos apenas o discriminador
  // forte de cancelamento ("Cancelar Motivo"); a distinção final Pedidos × Falha
  // usa a dica do nome do arquivo (desempate) e/ou a seleção manual — o conteúdo
  // sozinho é ambíguo (ver data-contract.md, §"Detecção de relatório").
  signature: ['ID do pedido', 'Status do pedido', 'Número de rastreamento'],
  antiSignature: ['Cancelar Motivo'],
  confidenceCap: 0.7,
  priority: 10,
  normalize(row) {
    const b = new Builder(row);
    const orderId = b.id('ID do pedido');
    const tracking = b.str('Número de rastreamento');
    const status = b.str('Status do pedido');
    const occurredAt = b.date('Data da Finalização do Cancelamento');
    const createdAt = b.date('Data de criação do pedido');
    if (!orderId) b.issues.push(issue('MISSING_ID', ImportIssueSeverity.ERROR, 'Linha sem ID do pedido.', 'ID do pedido'));
    const naturalKey = `${orderId ?? ''}|${tracking ?? ''}`;
    return {
      normalized: {
        externalOrderId: orderId,
        trackingCode: tracking,
        status,
        occurredAt: occurredAt ? occurredAt.toISOString() : null,
      },
      identifiers: { externalOrderId: orderId, trackingCode: tracking },
      externalOrderId: orderId,
      externalReference: tracking,
      naturalKey,
      canonicalParts: [
        `orderId=${orderId ?? ''}`,
        `tracking=${tracking ?? ''}`,
        `status=${status ?? ''}`,
        `occurredAt=${canonicalDate(occurredAt)}`,
      ],
      issues: b.issues,
      eventDate: occurredAt ?? createdAt,
    };
  },
};

const returnRefundSpec: ReportSpec = {
  type: ReportType.RETURN_REFUND,
  label: REPORT_TYPE_LABELS[ReportType.RETURN_REFUND],
  signature: ['ID da Devolução', 'Quantia total de reembolsos'],
  confidenceCap: 1,
  priority: 35,
  normalize(row) {
    const b = new Builder(row);
    const returnId = b.id('ID da Devolução');
    const orderId = b.id('ID do pedido');
    const status = b.str('Status da Devolução / Reembolso');
    const resolution = b.str('Solução para Retorno e Reembolso');
    const requested = b.dec('Quantia total de reembolsos');
    const compensation = b.dec('Compensação ao Vendedor (Disputa bem sucedida/Ajuste em carteira)');
    const buyerPaid = b.dec('Valor pago pelo comprador');
    const trackingStatus = b.str('Status de rastreamento de devolução');
    const returnType = b.str('Tipo de Devolução');
    const qty = b.int('Quantidade de Devoluções');
    const createdAt = b.date('Data de criação do pedido');
    if (!returnId) b.issues.push(issue('MISSING_ID', ImportIssueSeverity.ERROR, 'Linha sem ID da Devolução.', 'ID da Devolução'));
    // §9.2: o hash canônico do EVENTO inclui status/valores/rastreio -> nova mudança = novo evento.
    const naturalKey = returnId ?? '';
    return {
      normalized: {
        externalReturnId: returnId,
        externalOrderId: orderId,
        status,
        resolution,
        returnType,
        returnedQuantity: qty,
        requestedRefundAmount: requested,
        sellerCompensationAmount: compensation,
        buyerPaidAmount: buyerPaid,
        returnTrackingStatus: trackingStatus,
      },
      identifiers: { externalReturnId: returnId, externalOrderId: orderId },
      externalOrderId: orderId,
      externalReference: returnId,
      naturalKey,
      canonicalParts: [
        `returnId=${returnId ?? ''}`,
        `status=${status ?? ''}`,
        `resolution=${resolution ?? ''}`,
        `requested=${canonicalDecimal(requested)}`,
        `compensation=${canonicalDecimal(compensation)}`,
        `trackingStatus=${trackingStatus ?? ''}`,
      ],
      issues: b.issues,
      eventDate: createdAt,
    };
  },
};

const walletSpec: ReportSpec = {
  type: ReportType.WALLET_TRANSACTION,
  label: REPORT_TYPE_LABELS[ReportType.WALLET_TRANSACTION],
  signature: ['Tipo de transação', 'Direção do dinheiro', 'Balança após as transações'],
  confidenceCap: 1,
  priority: 50,
  normalize(row) {
    const b = new Builder(row);
    const occurredAt = b.date('Data');
    const type = b.str('Tipo de transação');
    const description = b.str('Descrição');
    const orderId = b.id('ID do pedido');
    const direction = b.str('Direção do dinheiro');
    const amount = b.dec('Valor');
    const status = b.str('Status');
    const balanceAfter = b.dec('Balança após as transações');
    const adjustment = b.dec('Valor a Ser Ajustado');
    if (!occurredAt) b.issues.push(issue('MISSING_DATE', ImportIssueSeverity.ERROR, 'Movimentação sem data.', 'Data'));
    if (amount == null) b.issues.push(issue('MISSING_AMOUNT', ImportIssueSeverity.ERROR, 'Movimentação sem valor.', 'Valor'));
    // §5/§9.1: NUNCA usar (orderId,data,valor). O balanceAfter é discriminador forte.
    const naturalKey = `${orderId ?? ''}|${canonicalDate(occurredAt)}|${type ?? ''}|${canonicalDecimal(amount)}`;
    return {
      normalized: {
        occurredAt: occurredAt ? occurredAt.toISOString() : null,
        transactionType: type,
        description,
        externalOrderId: orderId,
        moneyDirection: direction,
        amount,
        status,
        balanceAfter,
        adjustmentAmount: adjustment,
      },
      identifiers: { externalOrderId: orderId },
      externalOrderId: orderId,
      externalReference: null,
      naturalKey,
      canonicalParts: [
        `occurredAt=${canonicalDate(occurredAt)}`,
        `type=${type ?? ''}`,
        `direction=${direction ?? ''}`,
        `amount=${canonicalDecimal(amount)}`,
        `orderId=${orderId ?? ''}`,
        `description=${description ?? ''}`,
        `balanceAfter=${canonicalDecimal(balanceAfter)}`,
        `adjustment=${canonicalDecimal(adjustment)}`,
        `status=${status ?? ''}`,
      ],
      issues: b.issues,
      eventDate: occurredAt,
    };
  },
};

const aceleraSpec: ReportSpec = {
  type: ReportType.SHOPEE_ACELERA,
  label: REPORT_TYPE_LABELS[ReportType.SHOPEE_ACELERA],
  signature: ['ID do resgate rápido', 'Valor dos resgates rápidos'],
  confidenceCap: 1,
  priority: 45,
  normalize(row) {
    const b = new Builder(row);
    const redemptionId = b.id('ID do resgate rápido');
    const orderId = b.id('ID do pedido');
    const requestDate = b.date('Data do resgate rápido');
    const status = b.str('Status');
    const accelerated = b.dec('Valor dos resgates rápidos');
    const fee = b.dec('Taxa de Serviço');
    const received = b.dec('Valor recebido');
    const refunded = b.dec('Valor reembolsado');
    const pending = b.dec('Valor pendente');
    const available = b.dec('Valor de pedidos disponível para resgate rápido');
    const percentage = b.pct('Percentual de resgate rápido');
    const maturity = b.date('Data de vencimento');
    if (!redemptionId) b.issues.push(issue('MISSING_ID', ImportIssueSeverity.ERROR, 'Linha sem ID do resgate rápido.', 'ID do resgate rápido'));
    // §9.1: nunca deduplicar só por orderId. Par (resgate,pedido)+status+valores.
    const naturalKey = `${redemptionId ?? ''}|${orderId ?? ''}`;
    return {
      normalized: {
        externalRedemptionId: redemptionId,
        externalOrderId: orderId,
        requestDate: requestDate ? requestDate.toISOString() : null,
        status,
        acceleratedAmount: accelerated,
        feeAmount: fee,
        netReceivedAmount: received,
        refundedAmount: refunded,
        pendingAmount: pending,
        availableAmount: available,
        accelerationPercentage: percentage,
        maturityDate: maturity ? maturity.toISOString() : null,
      },
      identifiers: { externalRedemptionId: redemptionId, externalOrderId: orderId },
      externalOrderId: orderId,
      externalReference: redemptionId,
      naturalKey,
      canonicalParts: [
        `redemptionId=${redemptionId ?? ''}`,
        `orderId=${orderId ?? ''}`,
        `requestDate=${canonicalDate(requestDate)}`,
        `status=${status ?? ''}`,
        `accelerated=${canonicalDecimal(accelerated)}`,
        `fee=${canonicalDecimal(fee)}`,
        `refunded=${canonicalDecimal(refunded)}`,
        `pending=${canonicalDecimal(pending)}`,
        `maturity=${canonicalDate(maturity)}`,
      ],
      issues: b.issues,
      eventDate: requestDate,
    };
  },
};

const affiliateCommissionSpec: ReportSpec = {
  type: ReportType.AFFILIATE_COMMISSION,
  label: REPORT_TYPE_LABELS[ReportType.AFFILIATE_COMMISSION],
  signature: ['Id de atribuição da comissão', 'Estado de dedução'],
  confidenceCap: 1,
  priority: 40,
  normalize(row) {
    const b = new Builder(row);
    const attributionId = b.id('Id de atribuição da comissão');
    const orderId = b.id('ID do pedido');
    const affiliate = b.str('Nome do afiliado');
    const purchase = b.dec('Valor da Compra');
    const refund = b.dec('Valor do reembolso');
    const commission = b.dec('Comissão do item da marca para o Afiliado');
    const serviceFee = b.dec('Taxa de serviço de Afiliados do Vendedor');
    const expenses = b.dec('despesas');
    const deductionStatus = b.str('Estado de dedução');
    const deductionMethod = b.str('Método de dedução');
    const billing = b.str('Período de cobrança da comissão');
    const sku = b.str('Número de referência SKU');
    if (!attributionId) b.issues.push(issue('MISSING_ID', ImportIssueSeverity.ERROR, 'Linha sem Id de atribuição da comissão.', 'Id de atribuição da comissão'));
    // §7: não colapsar comissões legítimas do mesmo pedido.
    const naturalKey = `${attributionId ?? ''}|${orderId ?? ''}|${sku ?? ''}|${affiliate ?? ''}`;
    return {
      normalized: {
        externalCommissionAttributionId: attributionId,
        externalOrderId: orderId,
        affiliateName: affiliate,
        purchaseAmount: purchase,
        refundAmount: refund,
        affiliateCommission: commission,
        serviceFee,
        expenses,
        deductionStatus,
        deductionMethod,
        billingPeriod: billing,
      },
      identifiers: { externalCommissionAttributionId: attributionId, externalOrderId: orderId },
      externalOrderId: orderId,
      externalReference: attributionId,
      naturalKey,
      canonicalParts: [
        `attributionId=${attributionId ?? ''}`,
        `orderId=${orderId ?? ''}`,
        `sku=${sku ?? ''}`,
        `affiliate=${affiliate ?? ''}`,
        `purchase=${canonicalDecimal(purchase)}`,
        `refund=${canonicalDecimal(refund)}`,
        `commission=${canonicalDecimal(commission)}`,
        `serviceFee=${canonicalDecimal(serviceFee)}`,
        `deductionStatus=${deductionStatus ?? ''}`,
      ],
      issues: b.issues,
      eventDate: null,
    };
  },
};

const affiliatePerformanceSpec: ReportSpec = {
  type: ReportType.AFFILIATE_PERFORMANCE,
  label: REPORT_TYPE_LABELS[ReportType.AFFILIATE_PERFORMANCE],
  signature: ['ID do Afiliado', 'ROI', 'Cliques'],
  confidenceCap: 1,
  priority: 40,
  normalize(row) {
    const b = new Builder(row);
    const affiliateId = b.id('ID do Afiliado');
    const username = b.str('Nome de usuário do afiliado');
    const sales = b.dec('Vendas(R$)');
    const orders = b.int('Pedidos');
    const clicks = b.int('Cliques');
    const estCommission = b.dec('Comissão estimada(R$)');
    const roi = b.dec('ROI');
    if (!affiliateId) b.issues.push(issue('MISSING_ID', ImportIssueSeverity.ERROR, 'Linha sem ID do Afiliado.', 'ID do Afiliado'));
    // Agregado por afiliado (sem pedido). Snapshot -> dedup pelos números.
    const naturalKey = affiliateId ?? '';
    return {
      normalized: {
        affiliateId,
        affiliateUsername: username,
        salesAmount: sales,
        orders,
        clicks,
        estimatedCommission: estCommission,
        roi,
      },
      identifiers: { affiliateId },
      externalOrderId: null,
      externalReference: affiliateId,
      naturalKey,
      canonicalParts: [
        `affiliateId=${affiliateId ?? ''}`,
        `sales=${canonicalDecimal(sales)}`,
        `orders=${orders ?? ''}`,
        `clicks=${clicks ?? ''}`,
        `estCommission=${canonicalDecimal(estCommission)}`,
        `roi=${canonicalDecimal(roi)}`,
      ],
      issues: b.issues,
      eventDate: null,
    };
  },
};

export const REPORT_SPECS: ReportSpec[] = [
  ordersSpec,
  cancellationSpec,
  failedDeliverySpec,
  returnRefundSpec,
  walletSpec,
  aceleraSpec,
  affiliateCommissionSpec,
  affiliatePerformanceSpec,
];

export function getReportSpec(type: ReportType): ReportSpec | undefined {
  return REPORT_SPECS.find((s) => s.type === type);
}
