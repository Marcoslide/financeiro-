import * as XLSX from 'xlsx';

/**
 * Constrói um arquivo .xlsx SINTÉTICO que reproduz o formato REAL do relatório de
 * produtos da Shopee descrito no prompt (§4):
 *
 *   linha 1  → nomes técnicos das colunas (uso interno da Shopee)
 *   linha 2  → linha de configuração/categoria
 *   linha 3  → CABEÇALHO amigável em português  ← é este que o importador procura
 *   linha 4–6 → linhas de instrução/exemplo (não são produtos)
 *   linha 7+ → PRODUTOS reais (o mesmo ID do Produto se repete por variação)
 *
 * Nenhum dado real é versionado; estes valores são fictícios (prompt "Segurança").
 */

const HEADERS = [
  'ID do Produto',
  'Nome do Produto',
  'Variante Identificador',
  'Nome',
  'SKU de referência',
  'SKU',
  'Preço',
  'GTIN (EAN)',
  'Estoque do Vendedor',
  'Motivo da Falha',
];

const TECH_ROW = [
  'ph_product_id',
  'ph_product_name',
  'ph_model_id',
  'ph_model_name',
  'ph_parent_sku',
  'ph_sku',
  'ph_price',
  'ph_gtin',
  'ph_stock',
  'ph_fail_reason',
];

const CONFIG_ROW = ['Configuração', '', '', '', '', '', '', '', '', ''];
const INSTRUCTION_ROWS = [
  ['Obrigatório', 'Obrigatório', 'Opcional', 'Opcional', 'Opcional', 'Obrigatório', 'Obrigatório', 'Opcional', 'Obrigatório', 'Sistema'],
  ['Preencha o ID', 'Preencha o nome', '', '', '', 'Preencha o SKU', 'Preço cheio', '', 'Estoque', ''],
  ['Exemplo: 123456', 'Exemplo: Quadro', '', '', '', 'Exemplo: SKU-1', '99.90', '', '10', ''],
];

export interface ProductRowInput {
  productId: string;
  productName: string;
  variationId: string;
  variationName: string;
  referenceSku: string;
  sku: string;
  price: string;
  gtin: string;
  stock: string;
  failReason: string;
}

/** Conjunto base de produtos/variações (3 anúncios válidos, 7 variações, 1 linha com erro). */
export const BASE_ROWS: ProductRowInput[] = [
  // Anúncio 1 — 4 variações (tamanhos/cores), preços variados por variação (§12)
  row('43819067914', 'Quadro Decorativo Paisagem', '111', '40x60 Preto', '', 'SKU-4060-PT', '199.90', '7890000000011', '10'),
  row('43819067914', 'Quadro Decorativo Paisagem', '112', '40x60 Branco', '', 'SKU-4060-BR', '199.90', '7890000000028', '5'),
  row('43819067914', 'Quadro Decorativo Paisagem', '113', '50x70 Preto', '', 'SKU-5070-PT', '269.00', '7890000000035', '8'),
  row('43819067914', 'Quadro Decorativo Paisagem', '114', '60x90 Preto', '', 'SKU-6090-PT', '479.00', '7890000000042', '3'),
  // Anúncio 2 — Kit com 2 molduras
  row('55500000001', 'Kit 3 Quadros Decorativos', '201', 'Moldura Preta', '', 'KIT3-PT', '149.00', '7890000000059', '20'),
  row('55500000001', 'Kit 3 Quadros Decorativos', '202', 'Moldura Branca', '', 'KIT3-BR', '149.00', '7890000000066', '0'),
  // Anúncio 3 — variação única (Variante Identificador vazio; agrupa pelo SKU)
  row('55500000002', 'Quadro Único Mandala', '', '', '', 'MANDALA-01', '89.90', '7890000000073', '15'),
  // Linha com ERRO — ID parece de produto, mas sem Nome do Produto (§17)
  row('55500000003', '', '301', 'Sem Nome', '', 'ERR-1', '10.00', '', '1'),
];

function row(
  productId: string,
  productName: string,
  variationId: string,
  variationName: string,
  referenceSku: string,
  sku: string,
  price: string,
  gtin: string,
  stock: string,
  failReason = '',
): ProductRowInput {
  return { productId, productName, variationId, variationName, referenceSku, sku, price, gtin, stock, failReason };
}

function toAoa(rows: ProductRowInput[]): (string | number)[][] {
  const dataRows = rows.map((r) => [
    r.productId,
    r.productName,
    r.variationId,
    r.variationName,
    r.referenceSku,
    r.sku,
    r.price,
    r.gtin,
    r.stock,
    r.failReason,
  ]);
  return [TECH_ROW, CONFIG_ROW, HEADERS, ...INSTRUCTION_ROWS, ...dataRows];
}

/** Gera o buffer .xlsx do relatório de produtos com as linhas informadas. */
export function buildProductWorkbook(rows: ProductRowInput[] = BASE_ROWS): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(toAoa(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
