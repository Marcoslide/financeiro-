import * as XLSX from 'xlsx';

/**
 * .xlsx sintético do relatório de PEDIDOS (cabeçalhos reais, incl. duplicados §19).
 * Cobre: dedup por ID, multi-item com financeiro repetido (§17), status normalizado,
 * SKU vinculado/não vinculado (§21/§24).
 */
function wb(headers: string[], rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, 'orders');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// Cabeçalhos com DUPLICADOS reais: "Desconto do vendedor" (2×), "Cidade" (2×).
const H = [
  'ID do pedido', 'Status do pedido', 'Cancelar Motivo', 'Status da Devolução / Reembolso',
  'Número de rastreamento', 'Opção de envio', 'Método de envio',
  'Data de criação do pedido', 'Hora do pagamento do pedido',
  'Nº de referência do SKU principal', 'Nome do Produto', 'Número de referência SKU', 'Nome da variação',
  'Preço original', 'Preço acordado', 'Quantidade', 'Subtotal do produto',
  'Desconto do vendedor', 'Desconto do vendedor', 'Número de produtos pedidos',
  'Valor Total', 'Taxa de transação', 'Taxa de comissão bruta', 'Taxa de comissão líquida',
  'Taxa de serviço bruta', 'Taxa de serviço líquida', 'Total global', 'Valor estimado do frete',
  'Nome do destinatário', 'Cidade', 'Bairro', 'Cidade', 'UF',
];

// Colunas por posição para montar linhas legíveis.
function row(o: Partial<Record<string, string | number>>): (string | number)[] {
  const map: Record<string, string | number> = {
    'ID do pedido': '', 'Status do pedido': '', 'Cancelar Motivo': '', 'Status da Devolução / Reembolso': '',
    'Número de rastreamento': '', 'Opção de envio': 'Padrão', 'Método de envio': 'Correios',
    'Data de criação do pedido': '2026-07-15', 'Hora do pagamento do pedido': '2026-07-15',
    'Nº de referência do SKU principal': '', 'Nome do Produto': '', 'Número de referência SKU': '', 'Nome da variação': 'Único',
    'Preço original': '', 'Preço acordado': '', 'Quantidade': '1', 'Subtotal do produto': '',
    'Desconto do vendedor#0': '', 'Desconto do vendedor#1': '', 'Número de produtos pedidos': '1',
    'Valor Total': '', 'Taxa de transação': '0', 'Taxa de comissão bruta': '0', 'Taxa de comissão líquida': '0',
    'Taxa de serviço bruta': '0', 'Taxa de serviço líquida': '0', 'Total global': '0', 'Valor estimado do frete': '0',
    'Nome do destinatário': 'Cliente Teste', 'Cidade#0': 'São Paulo', 'Bairro': 'Centro', 'Cidade#1': 'São Paulo', 'UF': 'SP',
    ...o,
  } as Record<string, string | number>;
  return [
    map['ID do pedido'], map['Status do pedido'], map['Cancelar Motivo'], map['Status da Devolução / Reembolso'],
    map['Número de rastreamento'], map['Opção de envio'], map['Método de envio'],
    map['Data de criação do pedido'], map['Hora do pagamento do pedido'],
    map['Nº de referência do SKU principal'], map['Nome do Produto'], map['Número de referência SKU'], map['Nome da variação'],
    map['Preço original'], map['Preço acordado'], map['Quantidade'], map['Subtotal do produto'],
    map['Desconto do vendedor#0'], map['Desconto do vendedor#1'], map['Número de produtos pedidos'],
    map['Valor Total'], map['Taxa de transação'], map['Taxa de comissão bruta'], map['Taxa de comissão líquida'],
    map['Taxa de serviço bruta'], map['Taxa de serviço líquida'], map['Total global'], map['Valor estimado do frete'],
    map['Nome do destinatário'], map['Cidade#0'], map['Bairro'], map['Cidade#1'], map['UF'],
  ];
}

/** Base: 4 pedidos, 5 itens (ORD-2 é multi-item; financeiro repetido nas 2 linhas). */
export function buildOrders(): Buffer {
  return wb(H, [
    row({ 'ID do pedido': 'ORD-1', 'Status do pedido': 'A Enviar', 'Nome do Produto': 'Quadro A', 'Número de referência SKU': 'SKU-1', 'Preço original': '150', 'Preço acordado': '100', 'Subtotal do produto': '100', 'Valor Total': '100', 'Taxa de transação': '2', 'Taxa de comissão líquida': '10', 'Taxa de serviço líquida': '5', 'Total global': '83' }),
    // ORD-2 multi-item: Valor Total e comissão REPETIDOS nas duas linhas.
    row({ 'ID do pedido': 'ORD-2', 'Status do pedido': 'Concluído', 'Nome do Produto': 'Quadro B', 'Número de referência SKU': 'SKU-2', 'Nome da variação': 'Preto', 'Preço acordado': '200', 'Subtotal do produto': '200', 'Número de produtos pedidos': '2', 'Valor Total': '400', 'Taxa de transação': '8', 'Taxa de comissão líquida': '40', 'Taxa de serviço líquida': '20', 'Total global': '332' }),
    row({ 'ID do pedido': 'ORD-2', 'Status do pedido': 'Concluído', 'Nome do Produto': 'Quadro B', 'Número de referência SKU': 'SKU-3', 'Nome da variação': 'Branco', 'Preço acordado': '200', 'Subtotal do produto': '200', 'Número de produtos pedidos': '2', 'Valor Total': '400', 'Taxa de transação': '8', 'Taxa de comissão líquida': '40', 'Taxa de serviço líquida': '20', 'Total global': '332' }),
    row({ 'ID do pedido': 'ORD-3', 'Status do pedido': 'Cancelado', 'Cancelar Motivo': 'Sem estoque', 'Nome do Produto': 'Quadro C', 'Número de referência SKU': 'SKU-UNK', 'Preço acordado': '90', 'Subtotal do produto': '90', 'Valor Total': '90' }),
    row({ 'ID do pedido': 'ORD-4', 'Status do pedido': 'Entregue', 'Nome do Produto': 'Quadro A', 'Número de referência SKU': 'SKU-1', 'Preço acordado': '100', 'Quantidade': '2', 'Subtotal do produto': '200', 'Número de produtos pedidos': '2', 'Valor Total': '200', 'Taxa de comissão líquida': '20' }),
  ]);
}

/** Variante: ORD-1 despachado (A Enviar → Enviado) + rastreamento novo (§6/§14). */
export function buildOrdersStatusChanged(): Buffer {
  return wb(H, [
    row({ 'ID do pedido': 'ORD-1', 'Status do pedido': 'Enviado', 'Número de rastreamento': 'BR123456789', 'Nome do Produto': 'Quadro A', 'Número de referência SKU': 'SKU-1', 'Preço original': '150', 'Preço acordado': '100', 'Subtotal do produto': '100', 'Valor Total': '100', 'Taxa de transação': '2', 'Taxa de comissão líquida': '10', 'Taxa de serviço líquida': '5', 'Total global': '83' }),
  ]);
}
