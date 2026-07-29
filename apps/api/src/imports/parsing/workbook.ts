import * as XLSX from 'xlsx';
import { FileFormat } from '@financeiro/shared';

/**
 * Modelo interno uniforme para XLSX/XLS/CSV. Cada célula guarda o texto de
 * exibição (usado na prévia e no hash) e o valor bruto (Date/number/string),
 * usado nos parsers de data/decimal com máxima fidelidade.
 */
export interface RawCell {
  text: string;
  raw: unknown;
}

export interface SheetData {
  name: string;
  /** Linhas físicas na ordem original; cada linha é um array de células por posição. */
  rows: RawCell[][];
}

export interface Workbook {
  sheets: SheetData[];
}

/** Sniff simples do delimitador de um CSV (`,` `;` ou tab). */
export function sniffDelimiter(sample: string): string {
  const firstLines = sample.split(/\r?\n/).slice(0, 10).join('\n');
  const counts: Record<string, number> = {
    ',': (firstLines.match(/,/g) ?? []).length,
    ';': (firstLines.match(/;/g) ?? []).length,
    '\t': (firstLines.match(/\t/g) ?? []).length,
  };
  let best = ',';
  let bestN = -1;
  for (const [d, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

/**
 * Parser de CSV próprio (RFC 4180 tolerante): respeita aspas, aspas escapadas
 * (`""`) e quebras de linha dentro de campos. Preserva o texto exatamente como
 * veio (inclusive a "guarda" `="123"`), sem coerção numérica.
 */
export function parseCsv(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = content.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    if (c === '\r') {
      // trata \r\n e \r isolado
      if (content[i + 1] === '\n') i++;
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // último campo/linha (se houver conteúdo pendente)
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/**
 * Decodifica o texto do CSV tolerando encodings comuns de exportações brasileiras.
 * Exportações da Shopee costumam ser UTF-8, mas algumas ferramentas geram
 * Windows-1252/Latin-1. Estratégia: BOM UTF-16/UTF-8 explícito; senão tenta UTF-8
 * e, se aparecer caractere de substituição (), refaz como latin1.
 */
export function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.slice(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // UTF-16 BE: troca a ordem dos bytes e lê como LE
    const swapped = Buffer.from(buffer.slice(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('�')) {
    // bytes inválidos em UTF-8 → provavelmente Latin-1/Windows-1252
    return buffer.toString('latin1');
  }
  return utf8;
}

/** Lê o arquivo bruto no modelo interno, de acordo com o formato REAL detectado. */
export function readWorkbook(buffer: Buffer, format: FileFormat): Workbook {
  if (format === FileFormat.CSV) {
    const content = decodeText(buffer);
    const delimiter = sniffDelimiter(content);
    const cells = parseCsv(content, delimiter);
    const rows: RawCell[][] = cells.map((r) => r.map((t) => ({ text: t, raw: t })));
    return { sheets: [{ name: 'CSV', rows }] };
  }

  // XLSX/XLS via SheetJS. cellDates preserva datas como Date; lemos duas visões:
  // valores brutos (raw:true) e texto formatado (raw:false) e as combinamos.
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: false, WTF: false });
  const sheets: SheetData[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) return { name, rows: [] };
    const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const textGrid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    });
    const rows: RawCell[][] = rawGrid.map((rawRow, r) => {
      const textRow = (textGrid[r] as unknown[]) ?? [];
      const width = Math.max(rawRow.length, textRow.length);
      const cells: RawCell[] = [];
      for (let c = 0; c < width; c++) {
        const raw = rawRow[c] ?? null;
        const t = textRow[c];
        const text = t == null ? (raw == null ? '' : String(raw)) : String(t);
        cells.push({ text, raw });
      }
      return cells;
    });
    return { name, rows };
  });
  return { sheets };
}
