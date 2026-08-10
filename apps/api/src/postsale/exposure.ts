import { Prisma } from '@prisma/client';

/**
 * Classificação financeira DETERMINÍSTICA de uma ocorrência (§21/§22). Baseada no
 * texto de status da Shopee (auditável e evolutível — não hard-code do estudo).
 * Regra central: valor SOLICITADO ≠ PREJUÍZO. Uma solicitação em análise é risco,
 * não perda.
 */
export type ExposureBucket = 'CONFIRMED' | 'AT_RISK' | 'CANCELLED' | 'RECOVERED' | 'UNCLASSIFIED';

const norm = (s: string | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const dnum = (d: Prisma.Decimal | null) => (d == null ? 0 : Number(d));

export interface OccurrenceExposureInput {
  status: string | null;
  requestedRefundAmount: Prisma.Decimal | null;
  sellerCompensationAmount: Prisma.Decimal | null;
}

export interface ExposureResult {
  bucket: ExposureBucket;
  requested: number;
  compensation: number;
  /** Prejuízo confirmado (0 quando ainda não confirmado). */
  confirmedLoss: number;
  /** Valor em risco (solicitado ainda não resolvido). */
  atRisk: number;
}

export function classifyExposure(o: OccurrenceExposureInput): ExposureResult {
  return classifyExposureNumbers(o.status, dnum(o.requestedRefundAmount), dnum(o.sellerCompensationAmount));
}

/** Versão pura (sem Prisma) — reutilizável no bundle de navegador. */
export function classifyExposureNumbers(status: string | null, requested: number, compensation: number): ExposureResult {
  const s = norm(status);
  const zero: ExposureResult = { bucket: 'UNCLASSIFIED', requested, compensation, confirmedLoss: 0, atRisk: 0 };

  if (/cancel|recus|rejeit|desist|nao aprov|indefer|encerrad sem/.test(s)) {
    return { ...zero, bucket: 'CANCELLED' };
  }
  if (compensation > 0) {
    return { ...zero, bucket: 'RECOVERED' };
  }
  if (/conclu|aprovad|reembols|pago|finaliz|sucesso|deferid/.test(s)) {
    return { ...zero, bucket: 'CONFIRMED', confirmedLoss: Math.max(0, requested - compensation) };
  }
  if (/anális|analise|pendente|process|aberto|solicit|aguard|andamento|revis|disput/.test(s)) {
    return { ...zero, bucket: 'AT_RISK', atRisk: requested };
  }
  // Sem status classificável: se há valor solicitado, tratamos como risco (conservador).
  if (requested > 0) return { ...zero, bucket: 'AT_RISK', atRisk: requested };
  return zero;
}

export const EXPOSURE_METHODOLOGY =
  'Classificação por status Shopee: CANCELADA/RECUSADA/DESISTÊNCIA = sem perda; ' +
  'COMPENSAÇÃO ao vendedor = recuperado; CONCLUÍDA/APROVADA/REEMBOLSADA = prejuízo confirmado ' +
  '(solicitado − compensação); EM ANÁLISE/PENDENTE/DISPUTA = em risco. ' +
  'Valor solicitado nunca é tratado automaticamente como prejuízo.';
