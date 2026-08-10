import * as XLSX from 'xlsx';

/** Constrói .xlsx sintéticos dos três relatórios de pós-venda (cabeçalhos reais). */
function wb(headers: string[], rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, 'Sheet1');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Devoluções: RET-1 multi-SKU (3 itens, reembolso 300 repetido); RET-2 em análise. */
export function buildReturnRefund(): Buffer {
  const H = ['ID da Devolução', 'ID do pedido', 'Data de criação do pedido', 'Nome do Produto', 'SKU principal', 'Nome da variação', 'SKU da Variação', 'Preço da unidade', 'Status da Devolução / Reembolso', 'Tipo de Devolução', 'Quantidade de Devoluções', 'Solução para Retorno e Reembolso', 'Motivo da Devolução', 'Quantia total de reembolsos', 'Compensação ao Vendedor (Disputa bem sucedida/Ajuste em carteira)', 'Valor pago pelo comprador'];
  return wb(H, [
    ['RET-1', 'ORDER-A', '2026-07-01', 'Quadro X', 'PA', 'Preto', 'SKU-1', '100', 'Reembolso Concluído', 'Devolução', '1', 'Reembolsar', 'Avaria', '300', '', '300'],
    ['RET-1', 'ORDER-A', '2026-07-01', 'Quadro X', 'PA', 'Branco', 'SKU-2', '100', 'Reembolso Concluído', 'Devolução', '1', 'Reembolsar', 'Avaria', '300', '', '300'],
    ['RET-1', 'ORDER-A', '2026-07-01', 'Quadro X', 'PA', 'Freijó', 'SKU-3', '100', 'Reembolso Concluído', 'Devolução', '1', 'Reembolsar', 'Avaria', '300', '', '300'],
    ['RET-2', 'ORDER-B', '2026-07-04', 'Quadro Y', 'PB', 'Único', 'SKU-9', '50', 'Em análise', 'Devolução', '1', 'Reembolsar', 'Arrependimento', '50', '', '50'],
  ]);
}

/** Cancelamentos: ORDER-C; ORDER-X (também aparece em falha de entrega). */
export function buildCancellation(): Buffer {
  const H = ['ID do pedido', 'Status do pedido', 'Cancelar Motivo', 'Status da Devolução / Reembolso', 'Número de rastreamento', 'Data de criação do pedido', 'Data da Finalização do Cancelamento', 'Nº de referência do SKU principal', 'Nome do Produto', 'Número de referência SKU', 'Nome da variação', 'Preço acordado', 'Quantidade', 'Valor Total'];
  return wb(H, [
    ['ORDER-C', 'Cancelado', 'Comprador desistiu', '', 'TRK1', '2026-07-02', '2026-07-03', 'PC', 'Quadro Z', 'SKU-5', 'Var', '80', '1', '80'],
    ['ORDER-X', 'Cancelado', 'Sem estoque', '', 'TRK2', '2026-07-02', '2026-07-05', 'PX', 'Quadro W', 'SKU-6', 'Var', '90', '1', '90'],
  ]);
}

/** Falhas de entrega: ORDER-X (mesmo pedido do cancelamento → cruzamento). */
export function buildFailedDelivery(): Buffer {
  const H = ['ID do pedido', 'Status do pedido', 'Status da Devolução / Reembolso', 'Número de rastreamento', 'Data de criação do pedido', 'Data da Finalização do Cancelamento', 'Nº de referência do SKU principal', 'Nome do Produto', 'Número de referência SKU', 'Nome da variação', 'Preço acordado', 'Quantidade'];
  return wb(H, [
    ['ORDER-X', 'Falha na entrega', '', 'TRK2', '2026-07-02', '2026-07-06', 'PX', 'Quadro W', 'SKU-6', 'Var', '90', '1'],
  ]);
}
