import { DetectedColumn, ReportType } from '@financeiro/shared';
import { SheetData, Workbook } from './workbook';
import { normalizeLabel } from './value-parsers';
import { REPORT_SPECS, ReportSpec } from './report-specs';

const SCAN_LIMIT = 40; // linhas iniciais varridas em busca do cabeçalho

export interface HeaderMatch {
  type: ReportType;
  sheetIndex: number;
  sheetName: string;
  headerRow: number; // 0-based
  score: number; // fração da assinatura presente (0..1)
  matched: number;
  total: number;
}

export interface DetectionResult {
  best: HeaderMatch | null;
  /** Confiança final (0..1) ponderada pelo teto do relatório. */
  confidence: number;
  candidates: HeaderMatch[];
  /** Se o nome do arquivo ajudou a desempatar dentro da família de pedidos. */
  usedFilenameHint?: boolean;
}

/** Família de relatórios que compartilham o layout de pedidos (ambíguos por conteúdo). */
const ORDER_FAMILY: ReportType[] = [
  ReportType.ORDERS,
  ReportType.ORDER_CANCELLATION,
  ReportType.FAILED_DELIVERY,
];

/**
 * Dica pelo nome do arquivo — usada APENAS como desempate dentro da família de
 * pedidos (o conteúdo continua sendo o sinal primário). Os nomes reais da Shopee
 * trazem palavras-chave estáveis (`toship`, `cancelled`, `failed_delivery`, …).
 */
export function reportTypeFromFilename(filename: string): ReportType | null {
  const n = filename.toLowerCase();
  if (/cancel/.test(n)) return ReportType.ORDER_CANCELLATION;
  if (/failed[_-]?delivery|falha/.test(n)) return ReportType.FAILED_DELIVERY;
  if (/toship|to[_-]?ship|pedido/.test(n)) return ReportType.ORDERS;
  if (/return|refund|devolu/.test(n)) return ReportType.RETURN_REFUND;
  if (/balance|wallet|carteira|transaction/.test(n)) return ReportType.WALLET_TRANSACTION;
  if (/performance/.test(n)) return ReportType.AFFILIATE_PERFORMANCE;
  if (/validation|commission|payment|comiss/.test(n)) return ReportType.AFFILIATE_COMMISSION;
  return null;
}

function rowLabelSet(sheet: SheetData, r: number): Set<string> {
  const set = new Set<string>();
  const row = sheet.rows[r] ?? [];
  for (const cell of row) {
    const t = (cell?.text ?? '').trim();
    if (t) set.add(normalizeLabel(t));
  }
  return set;
}

function scoreSpecOnRow(spec: ReportSpec, labels: Set<string>): number {
  if (spec.antiSignature) {
    for (const anti of spec.antiSignature) {
      if (labels.has(normalizeLabel(anti))) return 0;
    }
  }
  let matched = 0;
  for (const sig of spec.signature) {
    if (labels.has(normalizeLabel(sig))) matched++;
  }
  return matched / spec.signature.length;
}

/** Melhor linha de cabeçalho de um relatório específico em todo o workbook. */
function bestMatchForSpec(wb: Workbook, spec: ReportSpec): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  wb.sheets.forEach((sheet, sheetIndex) => {
    const limit = Math.min(sheet.rows.length, SCAN_LIMIT);
    for (let r = 0; r < limit; r++) {
      const labels = rowLabelSet(sheet, r);
      if (labels.size === 0) continue;
      const score = scoreSpecOnRow(spec, labels);
      if (score === 0) continue;
      let matched = 0;
      for (const sig of spec.signature) if (labels.has(normalizeLabel(sig))) matched++;
      const cand: HeaderMatch = {
        type: spec.type,
        sheetIndex,
        sheetName: sheet.name,
        headerRow: r,
        score,
        matched,
        total: spec.signature.length,
      };
      if (!best || cand.score > best.score) best = cand;
    }
  });
  return best;
}

/**
 * Detecta o relatório PELO CONTEÚDO (assinatura de cabeçalhos), varrendo todas
 * as abas e as primeiras linhas — resolve cabeçalho fora da linha 1 (Carteira
 * linha 18, Acelera linha 6) sem hardcode. Se `forced` for informado (correção
 * manual do usuário), usa esse tipo e apenas localiza o cabeçalho dele.
 */
export function detectReport(wb: Workbook, forced?: ReportType, filename?: string): DetectionResult {
  const candidates: HeaderMatch[] = [];
  for (const spec of REPORT_SPECS) {
    const m = bestMatchForSpec(wb, spec);
    if (m) candidates.push(m);
  }
  candidates.sort((a, b) => b.score - a.score);

  if (forced && forced !== ReportType.UNKNOWN) {
    const forcedMatch =
      candidates.find((c) => c.type === forced) ??
      // se a assinatura não casou nada, assume cabeçalho na 1ª linha não vazia da 1ª aba
      fallbackHeader(wb, forced);
    return { best: forcedMatch, confidence: forcedMatch ? Math.max(forcedMatch.score, 0.5) : 0, candidates };
  }

  // Escolhe o melhor: maior score; empate -> maior prioridade do spec.
  let best: HeaderMatch | null = null;
  let bestConfidence = 0;
  for (const cand of candidates) {
    const spec = REPORT_SPECS.find((s) => s.type === cand.type)!;
    const confidence = cand.score === 1 ? spec.confidenceCap : cand.score * spec.confidenceCap * 0.8;
    const better =
      !best ||
      confidence > bestConfidence ||
      (confidence === bestConfidence && spec.priority > REPORT_SPECS.find((s) => s.type === best!.type)!.priority);
    if (better) {
      best = cand;
      bestConfidence = confidence;
    }
  }

  // Desempate por nome de arquivo APENAS dentro da família de pedidos: o layout
  // Pedidos × Cancelamentos × Falha é ambíguo por conteúdo. O nome nunca sobrepõe
  // um conteúdo decisivo (ex.: presença de "Cancelar Motivo" fixa cancelamento).
  let usedFilenameHint = false;
  if (filename && best && ORDER_FAMILY.includes(best.type)) {
    const hint = reportTypeFromFilename(filename);
    if (hint && hint !== best.type && ORDER_FAMILY.includes(hint)) {
      // só troca se o alvo do nome casar o conteúdo AO MENOS tão bem quanto o
      // melhor atual — assim o nome nunca derruba um conteúdo decisivo
      // (ex.: "Cancelar Motivo" presente fixa Cancelamento com score 1).
      const hintCand = candidates.find(
        (c) => c.type === hint && c.score >= 0.66 && c.score >= best!.score,
      );
      if (hintCand) {
        best = hintCand;
        bestConfidence = Math.max(bestConfidence, 0.8);
        usedFilenameHint = true;
      }
    } else if (hint && hint === best.type) {
      bestConfidence = Math.max(bestConfidence, 0.85);
    }
  }

  if (!best || bestConfidence < 0.5) {
    return { best: null, confidence: bestConfidence, candidates, usedFilenameHint };
  }
  return { best, confidence: bestConfidence, candidates, usedFilenameHint };
}

function fallbackHeader(wb: Workbook, forced: ReportType): HeaderMatch | null {
  for (let s = 0; s < wb.sheets.length; s++) {
    const sheet = wb.sheets[s];
    for (let r = 0; r < Math.min(sheet.rows.length, SCAN_LIMIT); r++) {
      if (rowLabelSet(sheet, r).size > 0) {
        return { type: forced, sheetIndex: s, sheetName: sheet.name, headerRow: r, score: 0, matched: 0, total: 0 };
      }
    }
  }
  return null;
}

export interface ExtractedHeader {
  columns: DetectedColumn[];
  headerNames: string[]; // por posição (com nome real ou "Coluna N")
  dataStartRow: number; // 0-based
}

/** Extrai as colunas do cabeçalho escolhido, marcando nomes duplicados. */
export function extractHeader(sheet: SheetData, headerRow: number): ExtractedHeader {
  const raw = sheet.rows[headerRow] ?? [];
  // último índice com texto não vazio define a largura do cabeçalho
  let width = 0;
  raw.forEach((c, i) => {
    if ((c?.text ?? '').trim() !== '') width = i + 1;
  });
  const seen = new Map<string, number>();
  const columns: DetectedColumn[] = [];
  const headerNames: string[] = [];
  for (let i = 0; i < width; i++) {
    const name = (raw[i]?.text ?? '').trim() || `Coluna ${i + 1}`;
    const key = normalizeLabel(name);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const duplicate = count > 1 || raw.filter((c) => normalizeLabel((c?.text ?? '').trim()) === key).length > 1;
    columns.push({ index: i, name, duplicate });
    headerNames.push(name);
  }
  return { columns, headerNames, dataStartRow: headerRow + 1 };
}
