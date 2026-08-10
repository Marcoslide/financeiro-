/**
 * Normalização de status do PEDIDO (§13). Regra CENTRALIZADA e testável — nunca
 * espalhar pela interface. Preserva-se sempre o texto original; aqui só se deriva
 * o status OPERACIONAL normalizado que alimenta as abas (§2/§14).
 *
 * Abas: TODOS engloba tudo; as demais filtram pelo status normalizado.
 */
export type NormalizedStatus = 'NAO_PAGO' | 'A_ENVIAR' | 'ENVIADO' | 'CONCLUIDO' | 'CANCELADO' | 'OUTRO';

export const NORMALIZED_LABELS: Record<NormalizedStatus, string> = {
  NAO_PAGO: 'Não pago',
  A_ENVIAR: 'A enviar',
  ENVIADO: 'Enviado',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  OUTRO: 'Outro',
};

/** Abas da tela principal (§2), na ordem apresentada. */
export const ORDER_TABS: Array<{ key: 'ALL' | NormalizedStatus; label: string }> = [
  { key: 'ALL', label: 'Todos' },
  { key: 'NAO_PAGO', label: 'Não pago' },
  { key: 'A_ENVIAR', label: 'A enviar' },
  { key: 'ENVIADO', label: 'Enviado' },
  { key: 'CONCLUIDO', label: 'Concluído' },
  { key: 'CANCELADO', label: 'Cancelado' },
];

const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Mapeia o texto de status da Shopee para o status operacional.
 * Textos dinâmicos ("O comprador pode pedir uma devolução até …") representam
 * pedido já despachado e ainda não concluído → ENVIADO (§13).
 */
export function normalizeOrderStatus(original: string | null | undefined): NormalizedStatus {
  const s = norm(original);
  if (!s) return 'OUTRO';

  // Cancelamentos (inclui "cancelamento solicitado").
  if (/cancel/.test(s)) return 'CANCELADO';

  // Não pago.
  if (/nao pago|aguardando pagamento|unpaid/.test(s)) return 'NAO_PAGO';

  // Concluído.
  if (/conclu|completed|finalizad/.test(s)) return 'CONCLUIDO';

  // A enviar (a despachar).
  if (/a enviar|pedido recebido|a despachar|aguardando envio|processing|to ship|preparar/.test(s)) return 'A_ENVIAR';

  // Enviado / entregue / janela pós-venda ainda aberta.
  if (/enviado|entregue|delivered|shipped|a caminho|em transito|comprador pode pedir uma devolucao|devolucao ate/.test(s)) {
    return 'ENVIADO';
  }

  return 'OUTRO';
}
