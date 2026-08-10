import { describe, it, expect } from 'vitest';
import { parseProductSheet } from './product-sheet';
import { buildProductWorkbook, BASE_ROWS } from '../../../test/fixtures/product-workbook';

describe('parseProductSheet', () => {
  const parsed = parseProductSheet(buildProductWorkbook(), 'produtos.xlsx');

  it('localiza o cabeçalho amigável fora da linha 1 (linha 3) e os dados na linha 7', () => {
    expect(parsed.notRecognized).toBe(false);
    expect(parsed.headerRowIndex).toBe(3);
    expect(parsed.dataStartRowIndex).toBe(7);
  });

  it('ignora as linhas de instrução entre o cabeçalho e os dados', () => {
    expect(parsed.ignoredRows).toBe(3);
  });

  it('extrai uma linha por variação, preservando SKU, preço e estoque', () => {
    const pt = parsed.rows.find((r) => r.sku === 'SKU-4060-PT');
    expect(pt?.shopeeProductId).toBe('43819067914');
    expect(pt?.shopeeFullPrice).toBe('199.90'); // preserva o texto; valor idêntico a 199.9
    expect(pt?.sellerStock).toBe(10);
    expect(pt?.variationKey).toBe('vid:111');
  });

  it('agrupa a variação única (sem Variante Identificador) por SKU', () => {
    const single = parsed.rows.find((r) => r.sku === 'MANDALA-01');
    expect(single?.shopeeVariationId).toBeNull();
    expect(single?.variationKey).toBe('sku:mandala-01');
  });

  it('sinaliza a linha sem Nome do Produto como erro (sem descartar silenciosamente)', () => {
    const err = parsed.rows.find((r) => r.sku === 'ERR-1');
    expect(err?.error).toMatch(/Nome do Produto/);
  });

  it('reconhece todas as variações válidas do fixture', () => {
    const valid = parsed.rows.filter((r) => !r.error);
    expect(valid).toHaveLength(BASE_ROWS.length - 1);
  });
});
