/**
 * Motor DETERMINÍSTICO de impacto financeiro da ocorrência (§16/§19). Fonte única
 * de verdade — todas as telas, rankings, achados e a IA leem daqui, nunca recalculam
 * com regra própria. Nenhuma LLM participa.
 *
 * Regra central: "reembolso = prejuízo" está PROIBIDO. O impacto líquido conhecido é
 *   (custos conhecidos) − (recuperações conhecidas)
 * onde custos = reembolso pago + frete reverso + frete adicional + retrabalho + outros
 * e recuperações = compensação Shopee + recuperação de disputa + valor recuperável do produto.
 * CMV (custo da mercadoria perdida) só entra quando existir — nunca é inventado (§16).
 */
export type EventDirection = 'COST' | 'RECOVERY' | 'NEUTRAL';

export type EventType =
  | 'REEMBOLSO_SOLICITADO' | 'REEMBOLSO_PAGO' | 'FRETE_REVERSO' | 'FRETE_ADICIONAL'
  | 'COMPENSACAO_SHOPEE' | 'RECUPERACAO_DISPUTA' | 'PRODUTO_RECUPERADO' | 'PRODUTO_PERDIDO'
  | 'CUSTO_RETRABALHO' | 'AJUSTE_MANUAL' | 'OUTRO';

interface EventMeta { label: string; direction: EventDirection; bucket: 'refund' | 'additional' | 'recovery' | 'none' }

export const EVENT_TYPES: Record<EventType, EventMeta> = {
  REEMBOLSO_SOLICITADO: { label: 'Reembolso solicitado', direction: 'NEUTRAL', bucket: 'none' },
  REEMBOLSO_PAGO: { label: 'Reembolso pago', direction: 'COST', bucket: 'refund' },
  FRETE_REVERSO: { label: 'Frete reverso', direction: 'COST', bucket: 'additional' },
  FRETE_ADICIONAL: { label: 'Frete adicional', direction: 'COST', bucket: 'additional' },
  CUSTO_RETRABALHO: { label: 'Custo de retrabalho', direction: 'COST', bucket: 'additional' },
  PRODUTO_PERDIDO: { label: 'Produto perdido', direction: 'COST', bucket: 'additional' },
  COMPENSACAO_SHOPEE: { label: 'Compensação Shopee', direction: 'RECOVERY', bucket: 'recovery' },
  RECUPERACAO_DISPUTA: { label: 'Recuperação de disputa', direction: 'RECOVERY', bucket: 'recovery' },
  PRODUTO_RECUPERADO: { label: 'Produto recuperado', direction: 'RECOVERY', bucket: 'recovery' },
  AJUSTE_MANUAL: { label: 'Ajuste manual', direction: 'NEUTRAL', bucket: 'none' },
  OUTRO: { label: 'Outro', direction: 'NEUTRAL', bucket: 'none' },
};

export function defaultDirectionFor(type: string): EventDirection {
  return EVENT_TYPES[type as EventType]?.direction ?? 'NEUTRAL';
}
export function isKnownEventType(type: string): type is EventType {
  return type in EVENT_TYPES;
}

export interface ImpactEventInput {
  type: string;
  direction?: EventDirection;
  amount: number;
}

export interface ImpactResult {
  refundedTotal: number;
  additionalCostTotal: number;
  recoveredTotal: number;
  /** custos conhecidos − recuperações conhecidas. */
  knownNetImpact: number;
  /** CMV disponível? Sempre false até existir custo de mercadoria perdida. */
  cmvAvailable: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Calcula o impacto a partir dos eventos financeiros (+ valor recuperável do produto,
 * quando informado). `recoverableValue` entra como recuperação conhecida.
 */
export function computeImpact(events: ImpactEventInput[], recoverableValue = 0): ImpactResult {
  let refunded = 0, additional = 0, recovery = 0;
  for (const e of events) {
    const meta = EVENT_TYPES[e.type as EventType];
    const dir = e.direction ?? meta?.direction ?? 'NEUTRAL';
    const bucket = meta?.bucket ?? (dir === 'COST' ? 'additional' : dir === 'RECOVERY' ? 'recovery' : 'none');
    const amt = e.amount || 0;
    if (bucket === 'refund') refunded += amt;
    else if (bucket === 'additional') additional += amt;
    else if (bucket === 'recovery') recovery += amt;
    else if (dir === 'COST') additional += amt;
    else if (dir === 'RECOVERY') recovery += amt;
  }
  recovery += recoverableValue || 0;
  const known = refunded + additional - recovery;
  return {
    refundedTotal: r2(refunded),
    additionalCostTotal: r2(additional),
    recoveredTotal: r2(recovery),
    knownNetImpact: r2(known),
    cmvAvailable: false,
  };
}
