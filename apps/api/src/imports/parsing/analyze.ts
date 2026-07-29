import {
  DetectedColumn,
  FileFormat,
  ImportAnalysis,
  ImportIssue,
  ImportIssueSeverity,
  ReportType,
  REPORT_TYPE_LABELS,
} from '@financeiro/shared';
import { declaredExtension, detectFileFormat, isExtensionMismatch } from './format';
import { readWorkbook, RawCell, SheetData } from './workbook';
import { DetectionResult, detectReport, extractHeader } from './detect';
import { getReportSpec, ReportSpec } from './report-specs';
import { normalizeLabel } from './value-parsers';
import { fileHash as hashFile } from './hashing';
import { RowAccessor } from './row-accessor';

export interface ParsedRow {
  physicalRowNumber: number; // 1-based, posição no arquivo/aba
  logicalRowNumber: number; // 1-based, entre as linhas de dados
  headerNames: string[];
  values: string[]; // texto por posição (preservação bruta)
  cells: RawCell[]; // células com valor bruto (para normalização)
}

export interface ParsedFile {
  format: FileFormat;
  declaredExtension: string;
  extensionMismatch: boolean;
  fileHash: string;
  fileSizeBytes: number;
  sheetName: string | null;
  detection: DetectionResult;
  detectedReportType: ReportType;
  reportType: ReportType; // efetivo (forçado ou detectado)
  manualOverride: boolean;
  confidence: number;
  headerRowIndex: number | null; // 1-based físico
  dataStartRowIndex: number | null; // 1-based físico
  columns: DetectedColumn[];
  headerNames: string[];
  physicalRowCount: number;
  dataRows: ParsedRow[];
  spec?: ReportSpec;
}

const PERSONAL_DATA_LABELS = [
  'Telefone',
  'Endereço de entrega',
  'CEP',
  'Nome do destinatário',
  'Nome de usuário (comprador)',
  'Nome de usuário (Comprador)',
].map(normalizeLabel);

function isRowEmpty(cells: RawCell[]): boolean {
  return cells.every((c) => (c?.text ?? '').trim() === '');
}

/**
 * Lê e interpreta o arquivo de ponta a ponta (formato → detecção → cabeçalho →
 * linhas de dados). Determinístico: `analyze` e `confirm` chamam a MESMA função,
 * garantindo que a prévia corresponde ao que será processado.
 */
export function parseFile(buffer: Buffer, filename: string, forcedType?: ReportType): ParsedFile {
  const format = detectFileFormat(buffer);
  const ext = declaredExtension(filename);
  const extensionMismatch = isExtensionMismatch(format, ext);
  const wb = readWorkbook(buffer, format);
  const detection = detectReport(wb, forcedType, filename);
  const autoDetection = detectReport(wb, undefined, filename);
  const detectedReportType = autoDetection.best?.type ?? ReportType.UNKNOWN;

  const base: ParsedFile = {
    format,
    declaredExtension: ext,
    extensionMismatch,
    fileHash: hashFile(buffer),
    fileSizeBytes: buffer.length,
    sheetName: null,
    detection,
    detectedReportType,
    reportType: ReportType.UNKNOWN,
    manualOverride: !!forcedType && forcedType !== ReportType.UNKNOWN,
    confidence: detection.confidence,
    headerRowIndex: null,
    dataStartRowIndex: null,
    columns: [],
    headerNames: [],
    physicalRowCount: wb.sheets.reduce((acc, s) => Math.max(acc, s.rows.length), 0),
    dataRows: [],
  };

  const best = detection.best;
  if (!best) return base;

  const sheet: SheetData = wb.sheets[best.sheetIndex];
  const { columns, headerNames, dataStartRow } = extractHeader(sheet, best.headerRow);
  const spec = getReportSpec(best.type);

  const dataRows: ParsedRow[] = [];
  let logical = 0;
  for (let r = dataStartRow; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] ?? [];
    if (isRowEmpty(cells)) continue;
    logical++;
    const width = Math.max(headerNames.length, cells.length);
    const values: string[] = [];
    for (let c = 0; c < width; c++) values.push((cells[c]?.text ?? '').toString());
    dataRows.push({
      physicalRowNumber: r + 1,
      logicalRowNumber: logical,
      headerNames,
      values,
      cells,
    });
  }

  return {
    ...base,
    sheetName: sheet.name,
    reportType: forcedType && forcedType !== ReportType.UNKNOWN ? forcedType : best.type,
    headerRowIndex: best.headerRow + 1,
    dataStartRowIndex: dataStartRow + 1,
    columns,
    headerNames,
    physicalRowCount: sheet.rows.length,
    dataRows,
    spec,
  };
}

/** Período coberto (min/max das datas de evento das linhas). */
export function computePeriod(parsed: ParsedFile): { start: Date | null; end: Date | null } {
  if (!parsed.spec) return { start: null, end: null };
  let start: Date | null = null;
  let end: Date | null = null;
  for (const row of parsed.dataRows) {
    const accessor = new RowAccessor(row.headerNames, row.cells);
    const norm = parsed.spec.normalize(accessor);
    const d = norm.eventDate;
    if (!d) continue;
    if (!start || d < start) start = d;
    if (!end || d > end) end = d;
  }
  return { start, end };
}

/** Monta a análise (fase 1) exibida antes da confirmação. */
export function buildAnalysis(parsed: ParsedFile, alreadyImported: boolean): ImportAnalysis {
  const issues: ImportIssue[] = [];

  if (parsed.extensionMismatch) {
    issues.push({
      code: 'EXTENSION_MISMATCH',
      severity: ImportIssueSeverity.WARNING,
      message: `Extensão ".${parsed.declaredExtension}" não corresponde ao conteúdo real (${parsed.format}). A detecção usa o conteúdo, não a extensão.`,
    });
  }
  if (parsed.reportType === ReportType.UNKNOWN || parsed.confidence < 0.5) {
    issues.push({
      code: 'LOW_CONFIDENCE',
      severity: ImportIssueSeverity.WARNING,
      message: 'Não foi possível identificar o relatório com segurança. Selecione o tipo manualmente.',
    });
  }
  if (parsed.detectedReportType === ReportType.FAILED_DELIVERY || parsed.reportType === ReportType.FAILED_DELIVERY) {
    issues.push({
      code: 'AMBIGUOUS_FAILED_DELIVERY',
      severity: ImportIssueSeverity.INFO,
      message: 'Falha na entrega e Cancelamento compartilham o layout de pedidos. Confirme o tipo antes de importar.',
    });
  }
  if (parsed.headerRowIndex && parsed.headerRowIndex > 1) {
    issues.push({
      code: 'HEADER_OFFSET',
      severity: ImportIssueSeverity.INFO,
      message: `Cabeçalho localizado na linha ${parsed.headerRowIndex} (há metadados acima).`,
    });
  }
  const dups = parsed.columns.filter((c) => c.duplicate);
  const dupNames = Array.from(new Set(dups.map((c) => c.name)));
  if (dupNames.length > 0) {
    issues.push({
      code: 'DUPLICATE_COLUMNS',
      severity: ImportIssueSeverity.INFO,
      message: `Coluna(s) duplicada(s) preservada(s) por posição: ${dupNames.join(', ')}.`,
    });
  }
  const hasPersonal = parsed.headerNames.some((h) => PERSONAL_DATA_LABELS.includes(normalizeLabel(h)));
  if (hasPersonal) {
    issues.push({
      code: 'PERSONAL_DATA',
      severity: ImportIssueSeverity.INFO,
      message: 'O arquivo contém dados pessoais (endereço, telefone, comprador). Serão preservados com acesso restrito.',
    });
  }
  if (alreadyImported) {
    issues.push({
      code: 'ALREADY_IMPORTED',
      severity: ImportIssueSeverity.WARNING,
      message: 'Este arquivo (mesmo conteúdo) já foi importado antes. Confirmar não duplica dados: linhas repetidas serão marcadas como duplicadas.',
    });
  }

  const period = computePeriod(parsed);
  const previewRows = parsed.dataRows.slice(0, 15).map((row) => {
    const obj: Record<string, string> = {};
    row.headerNames.forEach((h, i) => {
      const name = h || `Coluna ${i + 1}`;
      // mantém ambas as ocorrências de nomes duplicados sufixando a 2ª
      obj[obj[name] !== undefined ? `${name} (2)` : name] = row.values[i] ?? '';
    });
    return obj;
  });

  return {
    fileFormat: parsed.format,
    declaredExtension: parsed.declaredExtension,
    extensionMismatch: parsed.extensionMismatch,
    fileHash: parsed.fileHash,
    fileSizeBytes: parsed.fileSizeBytes,
    sheetName: parsed.sheetName,
    detectedReportType: parsed.reportType,
    reportTypeConfidence: parsed.confidence,
    headerRowIndex: parsed.headerRowIndex,
    dataStartRowIndex: parsed.dataStartRowIndex,
    columns: parsed.columns,
    physicalRowCount: parsed.physicalRowCount,
    dataRowCount: parsed.dataRows.length,
    periodStart: period.start ? period.start.toISOString() : null,
    periodEnd: period.end ? period.end.toISOString() : null,
    previewRows,
    issues,
    alreadyImported,
  };
}

export const REPORT_LABEL = REPORT_TYPE_LABELS;
