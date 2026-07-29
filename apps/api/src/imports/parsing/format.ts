import { FileFormat } from '@financeiro/shared';

/**
 * Detecção do formato REAL pelo conteúdo (magic bytes), NUNCA só pela extensão.
 * Caso real: o relatório de devoluções vem com extensão `.xls`, mas o conteúdo é
 * um ZIP OOXML (XLSX). Ver docs/00-inspecao-dados.md §1 (observação 1).
 *
 *  - `PK\x03\x04`         => ZIP/OOXML  => XLSX
 *  - `\xD0\xCF\x11\xE0`   => OLE2 (CDF) => XLS (BIFF legado)
 *  - caso contrário        => texto     => CSV
 */
export function detectFileFormat(buffer: Buffer): FileFormat {
  if (buffer.length >= 4) {
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
      return FileFormat.XLSX;
    }
    if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
      return FileFormat.XLS;
    }
  }
  return FileFormat.CSV;
}

/** Extensão declarada (minúscula, sem ponto). */
export function declaredExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** O formato real bate com a extensão declarada? */
export function isExtensionMismatch(format: FileFormat, ext: string): boolean {
  if (format === FileFormat.XLSX) return !(ext === 'xlsx');
  if (format === FileFormat.XLS) return !(ext === 'xls');
  return !(ext === 'csv' || ext === 'txt' || ext === 'tsv' || ext === '');
}

/** Sanitiza o nome do arquivo (remove caminho e caracteres perigosos). */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'arquivo';
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'arquivo';
}
