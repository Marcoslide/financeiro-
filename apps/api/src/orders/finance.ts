/**
 * Cálculo financeiro DETERMINÍSTICO do pedido (§28/§29/§42). Nenhuma LLM participa.
 * Regras invioláveis:
 *  - PREÇO ACORDADO = receita real (§25). Preço original é só referência.
 *  - NÃO subtrair "Desconto do vendedor" de novo (§26) — já está no preço acordado.
 *  - Taxas de marketplace usam apenas as LÍQUIDAS validadas; nunca somar bruta+líquida (§42).
 *  - Custo ausente NUNCA vira zero (§24/§42): marca costPending e não afirma lucro.
 *  - Multi-item: taxas do pedido são rateadas por subtotal (§29), com marca "rateada".
 */

export interface OrderFinanceItemInput {
  /** subtotal comercial do item = preço acordado × quantidade (ou "Subtotal do produto"). */
  subtotal: number;
  /** custo total do item (snapshot) ou null quando não disponível. */
  costTotal: number | null;
  /** true quando o item está sem vínculo OU sem custo (impede lucro definitivo). */
  costUnknown: boolean;
}

export interface OrderFinanceInput {
  /** Taxas líquidas/validadas do pedido (§28). */
  commissionNet: number;
  serviceFeeNet: number;
  transactionFee: number;
  reverseShippingFee: number;
  items: OrderFinanceItemInput[];
}

export interface OrderFinanceItemResult {
  subtotal: number;
  allocatedFees: number; // rateada (§29)
  costTotal: number | null;
  estimatedResult: number | null; // null quando custo desconhecido
  estimatedMarginPct: number | null;
}

export interface OrderFinanceResult {
  /** Receita real = soma dos subtotais de item (preço acordado × qtd). */
  revenue: number;
  marketplaceFeesTotal: number;
  productCostTotal: number; // soma dos custos conhecidos
  costPending: boolean; // algum item sem custo/sem vínculo
  /** Resultado estimado; null quando há custo pendente (não afirmar lucro — §24). */
  estimatedResult: number | null;
  estimatedMarginPct: number | null;
  items: OrderFinanceItemResult[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeOrderFinance(input: OrderFinanceInput): OrderFinanceResult {
  const fees = round2(
    (input.commissionNet || 0) + (input.serviceFeeNet || 0) + (input.transactionFee || 0) + (input.reverseShippingFee || 0),
  );
  const revenue = round2(input.items.reduce((s, i) => s + (i.subtotal || 0), 0));
  const subtotalSum = input.items.reduce((s, i) => s + (i.subtotal || 0), 0);

  const costPending = input.items.some((i) => i.costUnknown);
  let productCostTotal = 0;

  const items: OrderFinanceItemResult[] = input.items.map((i) => {
    // Rateio proporcional ao subtotal (§29). Se todos subtotais forem 0, divide igualmente.
    const share = subtotalSum > 0 ? (i.subtotal || 0) / subtotalSum : 1 / (input.items.length || 1);
    const allocatedFees = round2(fees * share);
    const costTotal = i.costUnknown ? null : round2(i.costTotal || 0);
    if (costTotal != null) productCostTotal += costTotal;
    const estimatedResult = costTotal == null ? null : round2((i.subtotal || 0) - allocatedFees - costTotal);
    const estimatedMarginPct =
      estimatedResult == null || !i.subtotal ? null : round2((estimatedResult / i.subtotal) * 100);
    return { subtotal: round2(i.subtotal || 0), allocatedFees, costTotal, estimatedResult, estimatedMarginPct };
  });

  productCostTotal = round2(productCostTotal);
  const estimatedResult = costPending ? null : round2(revenue - fees - productCostTotal);
  const estimatedMarginPct =
    estimatedResult == null || !revenue ? null : round2((estimatedResult / revenue) * 100);

  return {
    revenue,
    marketplaceFeesTotal: fees,
    productCostTotal,
    costPending,
    estimatedResult,
    estimatedMarginPct,
    items,
  };
}
