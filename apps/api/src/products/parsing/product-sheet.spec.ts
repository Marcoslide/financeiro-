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

  it('§7: variações reais SEM ID e SEM SKU não colapsam — usa o nome da variação como identidade', () => {
    // Anúncio com 6 variações onde as linhas não têm Variante Identificador nem SKU.
    // Antes: todas caíam em "__single__" e colapsavam em 1. Agora: 6 chaves distintas.
    const rows = ['Preto 40x60', 'Branco 40x60', 'Freijó 40x60', 'Preto 50x70', 'Branco 50x70', 'Freijó 50x70'].map((nome) => ({
      productId: '90000001', productName: 'Kit Quadros Multi', variationId: '', variationName: nome,
      referenceSku: '', sku: '', price: '199.90', gtin: '', stock: '5', failReason: '',
    }));
    const p = parseProductSheet(buildProductWorkbook(rows), 'multi.xlsx');
    const vars = p.rows.filter((r) => r.shopeeProductId === '90000001');
    expect(vars).toHaveLength(6);
    const keys = new Set(vars.map((r) => r.variationKey));
    expect(keys.size).toBe(6); // nenhuma colisão → nenhuma variação perdida
    expect(vars[0].variationKey).toBe('var:preto 40x60');
    // idempotência: reparse do mesmo arquivo → mesmas chaves
    const p2 = parseProductSheet(buildProductWorkbook(rows), 'multi.xlsx');
    expect(p2.rows.filter((r) => r.shopeeProductId === '90000001').map((r) => r.variationKey)).toEqual(vars.map((r) => r.variationKey));
  });
});
