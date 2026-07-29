import { RawCell } from './workbook';
import { normalizeLabel } from './value-parsers';

/**
 * Acesso a uma linha de dados pelos rótulos do cabeçalho, tolerando nomes
 * DUPLICADOS (ex.: "Desconto do vendedor" aparece duas vezes) — o acesso por
 * ocorrência usa a POSIÇÃO, não só o nome. Ver docs/00-inspecao-dados.md §1 (obs. 5).
 */
export class RowAccessor {
  /** normalizedLabel -> lista de índices de coluna (na ordem em que aparecem). */
  private readonly index = new Map<string, number[]>();

  constructor(
    readonly headers: string[],
    private readonly cells: RawCell[],
  ) {
    headers.forEach((h, i) => {
      const key = normalizeLabel(h);
      const arr = this.index.get(key);
      if (arr) arr.push(i);
      else this.index.set(key, [i]);
    });
  }

  private colIndex(label: string, occurrence = 0): number | undefined {
    const arr = this.index.get(normalizeLabel(label));
    if (!arr) return undefined;
    return arr[occurrence];
  }

  has(label: string): boolean {
    return this.index.has(normalizeLabel(label));
  }

  occurrences(label: string): number {
    return this.index.get(normalizeLabel(label))?.length ?? 0;
  }

  /** Texto de exibição da coluna (por rótulo e ocorrência). */
  get(label: string, occurrence = 0): string {
    const i = this.colIndex(label, occurrence);
    if (i == null) return '';
    return this.cells[i]?.text ?? '';
  }

  /** Valor bruto (Date/number/string) da coluna — para parsers de data/decimal. */
  getRaw(label: string, occurrence = 0): unknown {
    const i = this.colIndex(label, occurrence);
    if (i == null) return null;
    return this.cells[i]?.raw ?? null;
  }

  /** A linha está inteiramente vazia? */
  isEmpty(): boolean {
    return this.cells.every((c) => (c?.text ?? '').trim() === '');
  }
}
