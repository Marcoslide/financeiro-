import { DetectedColumn, FileFormat } from '@financeiro/shared';
import { detectFileFormat, declaredExtension, isExtensionMismatch } from '../../imports/parsing/format';
import { readWorkbook, SheetData } from '../../imports/parsing/workbook';
import { RowAccessor } from '../../imports/parsing/row-accessor';
import { cleanId, normalizeLabel, parseDecimal, parseIntSafe } from '../../imports/parsing/value-parsers';
import { fileHash as hashFile } from '../../imports/parsing/hashing';

/**
 * Parser da planilha de PRODUTOS exportada pela Shopee (prompt §4).
 *
 * Ao contrário dos oito relatórios financeiros, este arquivo não é deduplicado por
 * linha nem preservado como "evento": ele materializa ANÚNCIOS e VARIAÇÕES. O
 * formato real do relatório de produtos tem particularidades tratadas aqui:
 *
 *  - há LINHAS TÉCNICAS/DE INSTRUÇÃO antes e logo abaixo do cabeçalho amigável
 *    (no arquivo real o cabeçalho aparece por volta da linha 3 e os produtos só
 *    começam algumas linhas depois). NÃO se pode assumir que a linha 1 é o
 *    cabeçalho nem que os dados começam imediatamente após ele;
 *  - o mesmo "ID do Produto" se repete em várias linhas — cada linha é uma
 *    VARIAÇÃO do anúncio (prompt §5);
 *  - "SKU de referência" costuma vir vazio, então o agrupamento é por "ID do
 *    Produto" e a individualização por "Variante Identificador" (prompt §14).
 */

const SCAN_LIMIT = 40; // linhas iniciais varridas em busca do cabeçalho

/** Rótulos que caracterizam o cabeçalho amigável do relatório de produtos. */
const REQUIRED_LABELS = ['ID do Produto', 'Nome do Produto'].map(normalizeLabel);
const STRONG_LABELS = ['SKU', 'Variante Identificador', 'Preço', 'Estoque do Vendedor'].map(normalizeLabel);

/** Aliases aceitos por campo (tolera pequenas variações de rótulo da Shopee). */
const FIELD_LABELS = {
  productId: ['ID do Produto', 'Id do Produto', 'Product ID'],
  productName: ['Nome do Produto', 'Nome do produto', 'Product Name'],
  variationId: ['Variante Identificador', 'Variação Identificador', 'Variation ID', 'ID da variação'],
  variationName: ['Nome', 'Nome da variação', 'Variation Name'],
  referenceSku: ['SKU de referência', 'SKU de Referência', 'Reference SKU'],
  sku: ['SKU', 'SKU da variação', 'Variation SKU'],
  price: ['Preço', 'Preco', 'Price'],
  gtin: ['GTIN (EAN)', 'GTIN(EAN)', 'GTIN', 'EAN'],
  stock: ['Estoque do Vendedor', 'Estoque', 'Seller Stock', 'Stock'],
  failReason: ['Motivo da Falha', 'Motivo de Falha', 'Fail Reason'],
} as const;

export interface ProductRowData {
  physicalRowNumber: number;
  shopeeProductId: string | null;
  productName: string | null;
  shopeeVariationId: string | null;
  variationKey: string;
  variationName: string | null;
  sku: string | null;
  referenceSku: string | null;
  gtin: string | null;
  shopeeFullPrice: string | null;
  sellerStock: number | null;
  failReason: string | null;
  /** Mensagem de erro se a linha não puder virar variação (sem ID, etc.). */
  error: string | null;
}

export interface ParsedProductSheet {
  format: FileFormat;
  declaredExtension: string;
  extensionMismatch: boolean;
  fileHash: string;
  fileSizeBytes: number;
  sheetName: string | null;
  headerRowIndex: number | null; // 1-based físico
  dataStartRowIndex: number | null; // 1-based físico
  columns: DetectedColumn[];
  headerNames: string[];
  physicalRowCount: number;
  rows: ProductRowData[];
  /** Linhas físicas ignoradas entre o cabeçalho e os dados (instruções/vazias). */
  ignoredRows: number;
  /** true se o cabeçalho do relatório de produtos não foi encontrado. */
  notRecognized: boolean;
}

function rowLabelSet(sheet: SheetData, r: number): Set<string> {
  const set = new Set<string>();
  for (const cell of sheet.rows[r] ?? []) {
    const t = (cell?.text ?? '').trim();
    if (t) set.add(normalizeLabel(t));
  }
  return set;
}

interface HeaderCandidate {
  sheetIndex: number;
  headerRow: number;
  score: number;
}

/** Localiza a linha do cabeçalho amigável varrendo todas as abas (prompt §4). */
function findHeader(sheets: SheetData[]): { sheetIndex: number; headerRow: number } | null {
  let best: HeaderCandidate | null = null;
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
    const sheet = sheets[sheetIndex];
    const limit = Math.min(sheet.rows.length, SCAN_LIMIT);
    for (let r = 0; r < limit; r++) {
      const labels = rowLabelSet(sheet, r);
      if (labels.size === 0) continue;
      const hasRequired = REQUIRED_LABELS.every((l) => labels.has(l));
      if (!hasRequired) continue;
      const score = STRONG_LABELS.filter((l) => labels.has(l)).length;
      if (!best || score > best.score) best = { sheetIndex, headerRow: r, score };
    }
  }
  return best ? { sheetIndex: best.sheetIndex, headerRow: best.headerRow } : null;
}

/** Uma célula de "ID do Produto" que representa dados reais (não instrução). */
function looksLikeProductId(value: string): boolean {
  const id = cleanId(value);
  if (!id) return false;
  // IDs de anúncio da Shopee são numéricos e longos; instruções trazem texto.
  return /^\d{4,}$/.test(id);
}

function extractHeaderColumns(sheet: SheetData, headerRow: number) {
  const raw = sheet.rows[headerRow] ?? [];
  let width = 0;
  raw.forEach((c, i) => {
    if ((c?.text ?? '').trim() !== '') width = i + 1;
  });
  const columns: DetectedColumn[] = [];
  const headerNames: string[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < width; i++) {
    const name = (raw[i]?.text ?? '').trim() || `Coluna ${i + 1}`;
    const key = normalizeLabel(name);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    columns.push({ index: i, name, duplicate: count > 1 });
    headerNames.push(name);
  }
  return { columns, headerNames };
}

/** Primeiro rótulo com valor não vazio, dentre os aliases. */
function getFirst(accessor: RowAccessor, labels: readonly string[]): string {
  for (const l of labels) {
    const v = accessor.get(l);
    if (v != null && v.trim() !== '') return v;
  }
  return '';
}

function strOrNull(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

/** Índice da coluna do "ID do Produto" no cabeçalho (para detectar linha de dados). */
function productIdColumnIndex(headerNames: string[]): number {
  const want = FIELD_LABELS.productId.map(normalizeLabel);
  for (let i = 0; i < headerNames.length; i++) {
    if (want.includes(normalizeLabel(headerNames[i]))) return i;
  }
  return -1;
}

/**
 * Lê e interpreta a planilha de produtos de ponta a ponta. Determinístico: a
 * mesma função alimenta a prévia e o processamento.
 */
export function parseProductSheet(buffer: Buffer, filename: string): ParsedProductSheet {
  const format = detectFileFormat(buffer);
  const ext = declaredExtension(filename);
  const extensionMismatch = isExtensionMismatch(format, ext);
  const wb = readWorkbook(buffer, format);

  const base: ParsedProductSheet = {
    format,
    declaredExtension: ext,
    extensionMismatch,
    fileHash: hashFile(buffer),
    fileSizeBytes: buffer.length,
    sheetName: null,
    headerRowIndex: null,
    dataStartRowIndex: null,
    columns: [],
    headerNames: [],
    physicalRowCount: wb.sheets.reduce((acc, s) => Math.max(acc, s.rows.length), 0),
    rows: [],
    ignoredRows: 0,
    notRecognized: true,
  };

  const header = findHeader(wb.sheets);
  if (!header) return base;

  const sheet = wb.sheets[header.sheetIndex];
  const { columns, headerNames } = extractHeaderColumns(sheet, header.headerRow);
  const idCol = productIdColumnIndex(headerNames);

  const rows: ProductRowData[] = [];
  let ignored = 0;
  let dataStartRow: number | null = null;

  for (let r = header.headerRow + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] ?? [];
    const isEmpty = cells.every((c) => (c?.text ?? '').trim() === '');
    if (isEmpty) continue; // linha vazia: ignorada silenciosamente

    const idText = idCol >= 0 ? (cells[idCol]?.text ?? '') : '';
    if (!looksLikeProductId(idText)) {
      // Linha de instrução/exemplo entre o cabeçalho e os dados (prompt §4).
      ignored++;
      continue;
    }
    if (dataStartRow == null) dataStartRow = r;

    const accessor = new RowAccessor(headerNames, cells);
    const shopeeProductId = cleanId(getFirst(accessor, FIELD_LABELS.productId));
    const productName = strOrNull(getFirst(accessor, FIELD_LABELS.productName));
    const shopeeVariationId = cleanId(getFirst(accessor, FIELD_LABELS.variationId));
    const variationName = strOrNull(getFirst(accessor, FIELD_LABELS.variationName));
    const sku = strOrNull(getFirst(accessor, FIELD_LABELS.sku));
    const referenceSku = strOrNull(getFirst(accessor, FIELD_LABELS.referenceSku));
    const gtin = strOrNull(getFirst(accessor, FIELD_LABELS.gtin));
    const priceRaw = getFirst(accessor, FIELD_LABELS.price);
    const priceParse = parseDecimal(priceRaw);
    const sellerStock = parseIntSafe(getFirst(accessor, FIELD_LABELS.stock));
    const failReason = strOrNull(getFirst(accessor, FIELD_LABELS.failReason));

    // Chave estável da variação dentro do anúncio (§7): prioriza o identificador da
    // Shopee; depois o SKU; depois o NOME da variação (evita colapsar variações reais
    // distintas que venham sem ID e sem SKU); por fim, a posição física (anúncio de
    // variação única/anônima). Sempre determinística entre reimportações — o mesmo
    // arquivo produz as mesmas chaves (idempotência §14). Nunca colapsa variações
    // distintas nem inventa variações (§8).
    const variationKey = shopeeVariationId
      ? `vid:${shopeeVariationId}`
      : sku
        ? `sku:${normalizeLabel(sku)}`
        : variationName
          ? `var:${normalizeLabel(variationName)}`
          : `row:${r + 1}`;

    let error: string | null = null;
    if (!shopeeProductId) error = 'Linha sem ID do Produto.';
    else if (!productName) error = 'Linha sem Nome do Produto.';

    rows.push({
      physicalRowNumber: r + 1,
      shopeeProductId,
      productName,
      shopeeVariationId,
      variationKey,
      variationName,
      sku,
      referenceSku,
      gtin,
      shopeeFullPrice: priceParse.decimal,
      sellerStock,
      failReason,
      error,
    });
  }

  return {
    ...base,
    sheetName: sheet.name,
    headerRowIndex: header.headerRow + 1,
    dataStartRowIndex: dataStartRow != null ? dataStartRow + 1 : null,
    columns,
    headerNames,
    physicalRowCount: sheet.rows.length,
    rows,
    ignoredRows: ignored,
    notRecognized: false,
  };
}
