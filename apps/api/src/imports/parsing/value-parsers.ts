/**
 * Parsers de valores brutos dos relatórios da Shopee.
 *
 * Regras derivadas da inspeção real (docs/00-inspecao-dados.md §2 e §3):
 * convivem TRÊS formatos monetários (`331.08`, `-44.31`, `R$99.54`, `R$331,08`,
 * `R$1.234,56`), datas em três granularidades ISO-like, seriais do Excel, IDs com
 * "guarda" de texto (`="219..."`) que NÃO podem perder zeros, e nulos `-`/`--`.
 *
 * Princípio: nunca usar float para dinheiro — devolvemos SEMPRE string decimal
 * canônica (ponto como separador) para virar Prisma.Decimal sem perda.
 */

const NULLISH = new Set(['', '-', '--', '—', 'n/a', 'na', 'null']);

export interface DecimalParse {
  /** String decimal canônica (ponto decimal, sem separador de milhar) ou null. */
  decimal: string | null;
  /** Texto original preservado. */
  raw: string;
  error?: string;
}

function stripCurrency(input: string): { body: string; negative: boolean } {
  // normaliza espaços não-quebráveis (U+00A0) para espaço comum
  let s = input.trim().replace(/\u00a0/g, ' ').trim();
  let negative = false;
  // Parênteses contábeis: (1.234,56) => negativo
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  // Prefixos/sufixos de moeda e espaços
  s = s.replace(/r\$/gi, '').replace(/\s+/g, '').trim();
  // Sinal explícito
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  return { body: s, negative };
}

/**
 * Converte um número textual com separadores ambíguos para string canônica.
 * Decide o separador decimal pelo último separador presente (`.` ou `,`),
 * tratando o outro como separador de milhar.
 */
function normalizeNumericBody(body: string): string | null {
  if (body === '') return null;
  if (!/^[0-9.,]+$/.test(body)) return null;

  const lastDot = body.lastIndexOf('.');
  const lastComma = body.lastIndexOf(',');

  let intPart: string;
  let fracPart: string;

  if (lastDot === -1 && lastComma === -1) {
    intPart = body;
    fracPart = '';
  } else {
    const decIsComma = lastComma > lastDot;
    const decPos = decIsComma ? lastComma : lastDot;
    const thousandsSep = decIsComma ? '.' : ',';
    intPart = body.slice(0, decPos).split(thousandsSep).join('');
    fracPart = body.slice(decPos + 1);
    // Se o "decimal" na verdade agrupa milhares (ex.: "1.234" => 3 dígitos),
    // e não há outro separador, é ambíguo; mantemos como decimal por segurança
    // financeira (valores reais têm 2 casas). intPart pode ficar vazio -> "0".
  }

  if (intPart === '') intPart = '0';
  if (!/^[0-9]*$/.test(intPart) || !/^[0-9]*$/.test(fracPart)) return null;
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/** Faz o parse de um valor monetário/decimal. Nulos viram null (sem erro). */
export function parseDecimal(input: unknown): DecimalParse {
  const raw = input == null ? '' : String(input);
  const trimmed = raw.trim();
  if (NULLISH.has(trimmed.toLowerCase())) return { decimal: null, raw };

  const { body, negative } = stripCurrency(trimmed);
  const normalized = normalizeNumericBody(body);
  if (normalized == null) {
    return { decimal: null, raw, error: `valor decimal inválido: "${raw}"` };
  }
  const signed = negative && normalized !== '0' ? `-${normalized}` : normalized;
  return { decimal: signed, raw };
}

/** Percentual: `100%` => "1", `50%` => "0.5". Sem `%`, trata como razão já pronta. */
export function parsePercent(input: unknown): DecimalParse {
  const raw = input == null ? '' : String(input);
  const trimmed = raw.trim();
  if (NULLISH.has(trimmed.toLowerCase())) return { decimal: null, raw };
  const hasPercent = trimmed.includes('%');
  const base = parseDecimal(trimmed.replace('%', ''));
  if (base.decimal == null) return { decimal: null, raw, error: base.error };
  if (!hasPercent) return { decimal: base.decimal, raw };
  const asNumber = Number(base.decimal) / 100;
  if (!Number.isFinite(asNumber)) return { decimal: null, raw, error: 'percentual inválido' };
  return { decimal: trimZeros(asNumber.toFixed(6)), raw };
}

function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export interface DateParse {
  date: Date | null;
  /** ISO com offset de São Paulo (-03:00) quando derivado de texto. */
  iso: string | null;
  raw: string;
  error?: string;
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // 1899-12-30

/** Converte serial do Excel (dias desde 1899-12-30) para Date. */
export function excelSerialToDate(serial: number): Date {
  const ms = Math.round(serial * 86400 * 1000);
  return new Date(EXCEL_EPOCH_UTC + ms);
}

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parse de data. Aceita:
 *  - Date já pronto (célula de data do Excel) via `rawValue`;
 *  - número serial do Excel;
 *  - texto ISO-like `YYYY-MM-DD[ HH:MM[:SS]]` (interpretado em America/Sao_Paulo).
 */
export function parseDate(input: unknown, rawValue?: unknown): DateParse {
  const raw = input == null ? '' : String(input);
  const trimmed = raw.trim();

  if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
    return { date: rawValue, iso: rawValue.toISOString(), raw };
  }
  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 0) {
    const d = excelSerialToDate(rawValue);
    return { date: d, iso: d.toISOString(), raw };
  }
  if (NULLISH.has(trimmed.toLowerCase())) return { date: null, iso: null, raw };

  const m = DATE_RE.exec(trimmed);
  if (m) {
    const [, y, mo, d, hh, mm, ss] = m;
    const iso = `${y}-${mo}-${d}T${hh ?? '00'}:${mm ?? '00'}:${ss ?? '00'}-03:00`;
    const date = new Date(iso);
    if (isNaN(date.getTime())) return { date: null, iso: null, raw, error: `data inválida: "${raw}"` };
    return { date, iso, raw };
  }

  // Número serial em texto
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const d = excelSerialToDate(Number(trimmed));
    if (!isNaN(d.getTime())) return { date: d, iso: d.toISOString(), raw };
  }

  return { date: null, iso: null, raw, error: `formato de data não reconhecido: "${raw}"` };
}

/**
 * Limpa um identificador externo. Remove a "guarda" do Excel `="123"` e aspas,
 * preservando TODOS os dígitos (nunca converte para número — não perde zeros).
 */
export function cleanId(input: unknown): string | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === '') return null;
  // ="219..."  ->  219...
  const guard = /^=?"(.*)"$/.exec(s);
  if (guard) s = guard[1].trim();
  // remove aspas simples de proteção
  s = s.replace(/^'+/, '').trim();
  if (s === '' || NULLISH.has(s.toLowerCase())) return null;
  return s;
}

/** Parse de inteiro tolerante (retorna null se vazio/nulo). */
export function parseIntSafe(input: unknown): number | null {
  const raw = input == null ? '' : String(input).trim();
  if (NULLISH.has(raw.toLowerCase())) return null;
  const cleaned = raw.replace(/[.\s]/g, '').replace(',', '');
  if (!/^-?\d+$/.test(cleaned)) return null;
  return parseInt(cleaned, 10);
}

/** Normaliza um rótulo de cabeçalho para comparação (sem acento, minúsculo, espaços colapsados). */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
