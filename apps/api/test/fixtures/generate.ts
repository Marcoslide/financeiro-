/**
 * Gerador de FIXTURES sanitizadas dos oito relatórios reais da Shopee.
 *
 * Os arquivos reais NÃO são versionados (contêm dados pessoais — ver .gitignore
 * e docs/00-inspecao-dados.md §5). Estas fixtures reproduzem FIELMENTE a
 * estrutura e o volume documentados no Bloco 0 (cabeçalhos exatos, cabeçalho
 * fora da linha 1, extensão .xls com conteúdo XLSX, formatos monetários, colunas
 * duplicadas, IDs com guarda, etc.), mas com dados de demonstração.
 *
 * Determinístico (RNG com semente) para hashes estáveis entre execuções.
 * Uso: `tsx apps/api/test/fixtures/generate.ts`
 */
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

const OUT = path.resolve(__dirname, 'files');

// ---- RNG determinístico (LCG) ----
let seed = 20260729;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function pad(n: number, len: number): string {
  return String(n).padStart(len, '0');
}
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function alnum(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += B36[Math.floor(rnd() * 36)];
  return s;
}
/** ID de pedido: 14 chars, 6 primeiros = AAMMDD (jul/2026). */
function orderId(): string {
  const day = 1 + Math.floor(rnd() * 28);
  return `2607${pad(day, 2)}${alnum(8)}`;
}
function dateWithTime(day: number): string {
  const h = Math.floor(rnd() * 24);
  const mi = Math.floor(rnd() * 60);
  const s = Math.floor(rnd() * 60);
  return `2026-07-${pad(day, 2)} ${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}`;
}
function money2(n: number): string {
  return n.toFixed(2);
}
function moneyBR(n: number): string {
  return 'R$' + n.toFixed(2).replace('.', ',');
}
function moneyRS(n: number): string {
  return 'R$' + n.toFixed(2);
}

function ensureOut() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
}
function writeXlsx(filename: string, sheetName: string, aoa: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, path.join(OUT, filename), { bookType: 'xlsx' });
}
/** Escreve conteúdo XLSX mas com nome .xls (caso real de extensão enganosa). */
function writeXlsxAsXls(filename: string, sheetName: string, aoa: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  fs.writeFileSync(path.join(OUT, filename), buf);
}
function writeCsv(filename: string, lines: string[]) {
  fs.writeFileSync(path.join(OUT, filename), lines.join('\n'), 'utf8');
}
function csvRow(cells: string[]): string {
  return cells
    .map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
    .join(',');
}

const PRODUCTS = ['Moldura A4 Dourada', 'Quadro Decorativo 30x40', 'Porta-retrato 15x21', 'Moldura A3 Preta', 'Quadro Abstrato 50x70'];
const STATUS_ORDER = ['Concluído', 'A caminho', 'Para enviar', 'Pago'];

// ---------------------------------------------------------------------------
// 1. PEDIDOS (Order.toship) — XLSX, cabeçalho linha 1, 64 col, "Desconto do
//    vendedor" duplicado, "Taxa de comissão líquida", dados pessoais. 219 linhas.
// ---------------------------------------------------------------------------
const ORDERS_HEADERS = [
  'ID do pedido', 'Status do pedido', 'Hot Listing', 'Status da Devolução / Reembolso',
  'Número de rastreamento', 'Opção de envio', 'Método de envio', 'Data de criação do pedido',
  'Hora do pagamento do pedido', 'Data prevista de envio', 'Tempo de Envio', 'Domestic Delivered Date',
  'Hora completa do pedido', 'Data da Finalização do Cancelamento', 'Pedido FBS',
  'Nº de referência do SKU principal', 'Nome do Produto', 'Número de referência SKU', 'Nome da variação',
  'Shopee Owned', 'Preço original', 'Preço acordado', 'Quantidade', 'Subtotal do produto',
  'Desconto do vendedor', 'Desconto do vendedor', 'Incentivo Shopee para ação comercial',
  'Ajuste por participação em ação comercial', 'Peso total SKU', 'Número de produtos pedidos',
  'Peso total do pedido', 'Código do Cupom', 'Cupom do vendedor', 'Coin Cashback Voucher',
  'Cupom', 'Incentivo de cupom', 'Ajuste por pagamento via PIX', 'Indicador da Leve Mais por Menos',
  'Desconto Shopee da Leve Mais por Menos', 'Desconto da Leve Mais por Menos do vendedor',
  'Compensar Moedas Shopee', 'Total descontado Cartão de Crédito', 'Valor Total',
  'Taxa de envio pagas pelo comprador', 'Taxa de Envio Reversa', 'Taxa de transação',
  'Taxa de comissão bruta', 'Taxa de comissão líquida', 'Taxa de serviço bruta', 'Taxa de serviço líquida',
  'Total global', 'Valor estimado do frete', 'Nome de usuário (comprador)', 'Nome do destinatário',
  'Telefone', 'Endereço de entrega', 'Cidade', 'Bairro', 'Cidade', 'UF', 'País', 'CEP',
  'Observação do comprador', 'Nota',
];
function genOrders(): unknown[][] {
  const rows: unknown[][] = [ORDERS_HEADERS];
  for (let i = 0; i < 219; i++) {
    const oid = orderId();
    const day = parseInt(oid.slice(4, 6), 10);
    const price = 20 + Math.floor(rnd() * 480) + 0.9;
    const qty = 1 + Math.floor(rnd() * 3);
    const subtotal = price * qty;
    const commissionNet = subtotal * 0.12;
    const serviceNet = subtotal * 0.02;
    const row: unknown[] = new Array(ORDERS_HEADERS.length).fill('');
    row[0] = oid;
    row[1] = pick(STATUS_ORDER);
    row[7] = dateWithTime(day);
    row[8] = dateWithTime(day);
    row[14] = pick(['Não', 'Sim']);
    row[15] = 'SKU-' + pad(1000 + i, 4);
    row[16] = pick(PRODUCTS);
    row[17] = 'VAR-' + pad(1 + (i % 40), 3); // variação (usada como variationSku)
    row[20] = money2(price + 10);
    row[21] = money2(price);
    row[22] = String(qty);
    row[23] = money2(subtotal);
    row[24] = money2(subtotal * 0.05); // Desconto do vendedor (1ª)
    row[25] = money2(subtotal * 0.03); // Desconto do vendedor (2ª — duplicada)
    row[42] = money2(subtotal); // Valor Total
    row[44] = money2(subtotal * 0.01); // Taxa de transação
    row[46] = money2(commissionNet); // Taxa de comissão líquida
    row[48] = money2(serviceNet); // Taxa de serviço líquida
    row[50] = money2(subtotal - commissionNet - serviceNet); // Total global
    row[52] = `comprador_demo_${i}`;
    row[53] = `Comprador Demonstração ${i}`;
    row[54] = `(11) 9${pad(i, 4)}-0000`;
    row[55] = `Rua Exemplo, ${100 + i}`;
    row[61] = pad(1000000 + i, 8).replace(/(\d{5})(\d{3})/, '$1-$2');
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2. CANCELAMENTOS — XLSX, cabeçalho linha 1, "Cancelar Motivo", financeiro zerado. 346.
// ---------------------------------------------------------------------------
const CANCEL_HEADERS = [
  'ID do pedido', 'Status do pedido', 'Cancelar Motivo', 'Data de criação do pedido',
  'Data da Finalização do Cancelamento', 'Nº de referência do SKU principal', 'Nome do Produto',
  'Número de referência SKU', 'Preço original', 'Preço acordado', 'Quantidade', 'Subtotal do produto',
  'Desconto do vendedor', 'Desconto do vendedor', 'Valor Total', 'Total global',
  'Nome de usuário (comprador)', 'Telefone', 'CEP',
];
const CANCEL_REASONS = [
  'Cancelado automaticamente pelo sistema Shopee. Motivo: Pedido não pago',
  'Cancelado pelo comprador. Motivo: Mudança de ideia',
  'Cancelado pelo vendedor. Motivo: Sem estoque',
];
function genCancellations(): unknown[][] {
  const rows: unknown[][] = [CANCEL_HEADERS];
  for (let i = 0; i < 346; i++) {
    const oid = orderId();
    const day = parseInt(oid.slice(4, 6), 10);
    const row: unknown[] = new Array(CANCEL_HEADERS.length).fill('');
    row[0] = oid;
    row[1] = 'Cancelado';
    row[2] = pick(CANCEL_REASONS);
    row[3] = dateWithTime(day);
    row[4] = dateWithTime(day);
    row[6] = pick(PRODUCTS);
    row[7] = 'SKU-' + pad(2000 + i, 4);
    row[8] = money2(50 + rnd() * 100);
    row[9] = money2(40 + rnd() * 90);
    row[10] = '1';
    row[11] = money2(40 + rnd() * 90);
    row[12] = '0.00';
    row[13] = '0.00';
    row[14] = '0.00'; // Valor Total zerado
    row[15] = '0.00';
    row[16] = `comprador_demo_c${i}`;
    row[17] = `(11) 9${pad(i, 4)}-1111`;
    row[18] = '02000-000';
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 3. FALHA NA ENTREGA — XLSX, schema de pedidos SEM "Cancelar Motivo" e SEM
//    "Taxa de comissão líquida" (ambíguo → baixa confiança). 8 linhas.
// ---------------------------------------------------------------------------
const FAILED_HEADERS = [
  'ID do pedido', 'Status do pedido', 'Número de rastreamento', 'Opção de envio',
  'Data de criação do pedido', 'Data da Finalização do Cancelamento',
  'Nome do Produto', 'Número de referência SKU', 'Preço acordado', 'Quantidade',
  'Subtotal do produto', 'Valor Total', 'Nome de usuário (comprador)', 'CEP',
];
function genFailed(): unknown[][] {
  const rows: unknown[][] = [FAILED_HEADERS];
  for (let i = 0; i < 8; i++) {
    const oid = orderId();
    const day = parseInt(oid.slice(4, 6), 10);
    const row: unknown[] = new Array(FAILED_HEADERS.length).fill('');
    row[0] = oid;
    row[1] = 'Cancelado';
    row[2] = 'BR' + alnum(11);
    row[3] = 'Shopee Xpress';
    row[4] = dateWithTime(day);
    row[5] = dateWithTime(day);
    row[6] = pick(PRODUCTS);
    row[7] = 'SKU-' + pad(3000 + i, 4);
    row[8] = money2(60 + rnd() * 100);
    row[9] = '1';
    row[10] = money2(60 + rnd() * 100);
    row[11] = '0.00';
    row[12] = `comprador_demo_f${i}`;
    row[13] = '03000-000';
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 4. DEVOLUÇÕES — conteúdo XLSX, extensão .xls; "ID da Devolução",
//    "Quantia total de reembolsos" em R$..,.. (BR). 150 linhas / 133 pedidos.
//    Inclui uma devolução repetida com status diferente (→ UPDATED).
// ---------------------------------------------------------------------------
const RETURN_HEADERS = [
  'ID da Devolução', 'ID do pedido', 'Data de criação do pedido', 'Nome de usuário (Comprador)',
  'Nome do Produto', 'SKU principal', 'Nome da variação', 'SKU da Variação', 'IMEI', 'Preço da unidade',
  'Tempo de envio de devolução', 'Status da Devolução / Reembolso', 'Tipo de Devolução',
  'Quantidade de Devoluções', 'Solução para Retorno e Reembolso', 'Motivo da Devolução',
  'Observações da Devolução', 'Quantia total de reembolsos', 'Tempo decorrido de reembolso',
  'Retorno ao Armazém Shopee', 'Opção de envio de devolução', 'Número de rastreamento de devolução',
  'Status de rastreamento de devolução', 'Tempo de entrega de devolução concluída',
  'Endereço de entrega', 'UF', 'Cidade', 'CEP', 'Telefone', 'Endereço de coleta de devolução',
  'Estado', 'Cidade', 'CEP', 'Buyer contact number', 'Ação do Vendedor solicitada até',
  'Motivo da disputa', 'Observação do vendedor',
  'Compensação ao Vendedor (Disputa bem sucedida/Ajuste em carteira)', 'Opção de Entrega',
  'Tipo de Estoque', 'Número de rastreio', 'Valor pago pelo comprador', 'Método de pagamento',
  'Observação do Comprador', 'Hot Listing', 'Motivo da devolução revisado',
];
const RETURN_STATUS = ['Reembolso aprovado', 'Solicitação cancelada', 'Em análise', 'Reembolso concluído'];
function genReturns(): { aoa: unknown[][]; repeatedReturnId: string } {
  const rows: unknown[][] = [RETURN_HEADERS];
  const orderPool: string[] = [];
  for (let i = 0; i < 133; i++) orderPool.push(orderId());
  let repeatedReturnId = '';
  for (let i = 0; i < 149; i++) {
    const oid = orderPool[i % orderPool.length]; // alguns pedidos repetem (1:N)
    const day = parseInt(oid.slice(4, 6), 10);
    const rid = `2607${pad(day, 2)}${alnum(9)}`;
    const refund = 20 + rnd() * 300;
    const row: unknown[] = new Array(RETURN_HEADERS.length).fill('');
    row[0] = rid;
    row[1] = oid;
    row[2] = dateWithTime(day);
    row[3] = `comprador_demo_r${i}`;
    row[4] = pick(PRODUCTS);
    row[11] = pick(RETURN_STATUS);
    row[12] = pick(['Reembolso', 'Devolução e reembolso']);
    row[13] = '1';
    row[14] = pick(['Reembolso somente', 'Devolver e reembolsar']);
    row[15] = pick(['Produto com defeito', 'Não era o esperado', 'Chegou danificado']);
    row[17] = moneyBR(refund); // Quantia total de reembolsos (R$..,..)
    row[22] = pick(['Em trânsito', 'Entregue', '-']);
    row[24] = `Rua Exemplo, ${200 + i}`;
    row[27] = '04000-000';
    row[37] = pick(['R$0,00', moneyBR(refund * 0.5)]); // Compensação ao Vendedor
    row[41] = moneyBR(refund + 10); // Valor pago pelo comprador
    if (i === 0) repeatedReturnId = rid;
    rows.push(row);
  }
  // 150ª linha: mesma devolução da 1ª, com STATUS diferente (muda de estado → UPDATED)
  const first = rows[1].slice() as unknown[];
  first[11] = 'Reembolso concluído';
  first[37] = moneyBR(99.9);
  rows.push(first);
  return { aoa: rows, repeatedReturnId };
}

// ---------------------------------------------------------------------------
// 5. CARTEIRA — XLSX, cabeçalho na LINHA 18 (17 linhas de metadados/Resumo).
//    9 col, valores com sinal (-44.31), 232 linhas. Inclui duas movimentações
//    legítimas do mesmo pedido/dia/valor com direção+saldo diferentes.
// ---------------------------------------------------------------------------
const WALLET_HEADERS = [
  'Data', 'Tipo de transação', 'Descrição', 'ID do pedido', 'Direção do dinheiro', 'Valor',
  'Status', 'Balança após as transações', 'Valor a Ser Ajustado',
];
const WALLET_TYPES = ['Shopee Acelera', 'Ajuste', 'Renda do pedido', 'Pix', 'Saques'];
function genWallet(): unknown[][] {
  const aoa: unknown[][] = [];
  // 17 linhas de metadados (bloco Resumo)
  aoa.push(['Relatório de transações da carteira']);
  aoa.push(['Loja', 'lidermolduras']);
  aoa.push(['Período', '2026-07-01 a 2026-07-29']);
  aoa.push(['Moeda', 'BRL']);
  aoa.push([]);
  aoa.push(['Resumo']);
  aoa.push(['Entrada total de dinheiro', '253489.29']);
  aoa.push(['Saída total de dinheiro', '-253594.26']);
  aoa.push(['Saldo inicial', '1000.00']);
  aoa.push(['Saldo final', '895.03']);
  for (let k = 0; k < 7; k++) aoa.push([]); // completa até 17
  aoa.push(WALLET_HEADERS); // linha 18

  let balance = 1000;
  const sharedOrder = orderId();
  const sharedDay = parseInt(sharedOrder.slice(4, 6), 10);
  for (let i = 0; i < 230; i++) {
    const oid = orderId();
    const day = parseInt(oid.slice(4, 6), 10);
    const type = pick(WALLET_TYPES);
    const isOut = rnd() < 0.78;
    const amount = (5 + rnd() * 200) * (isOut ? -1 : 1);
    balance += amount;
    aoa.push([
      dateWithTime(day), type, `Movimentação referente ao pedido ${oid}`, oid,
      isOut ? 'Saída' : 'Entrada', money2(amount), 'Concluído', money2(balance), '',
    ]);
  }
  // Duas movimentações LEGÍTIMAS do mesmo pedido, mesmo dia, MESMO valor absoluto,
  // direções e saldos diferentes (não podem ser deduplicadas).
  balance += 100;
  aoa.push([dateWithTime(sharedDay), 'Renda do pedido', `Crédito do pedido ${sharedOrder}`, sharedOrder, 'Entrada', '100.00', 'Concluído', money2(balance), '']);
  balance -= 100;
  aoa.push([dateWithTime(sharedDay), 'Ajuste', `Débito do pedido ${sharedOrder}`, sharedOrder, 'Saída', '-100.00', 'Concluído', money2(balance), '']);
  return aoa;
}

// ---------------------------------------------------------------------------
// 6. SHOPEE ACELERA — CSV, cabeçalho na LINHA 6 (5 metadados, 1 em branco).
//    15 col, ID do resgate com guarda ="219...", R$99.54, 100%. 295 linhas / 5 resgates.
// ---------------------------------------------------------------------------
const ACELERA_HEADERS = [
  'Data do resgate rápido', 'ID do resgate rápido', 'ID do pedido',
  'Valor de pedidos disponível para resgate rápido', 'Percentual de resgate rápido',
  'Valor dos resgates rápidos', 'Taxa de Serviço', 'Valor recebido',
  'Valor restante para pagamento', 'Valor reembolsado', 'Faturamento total do pedido',
  'Valor pendente', 'Status', 'Data da última transação', 'Data de vencimento',
];
const ACELERA_STATUS = ['Antecipação paga', 'Totalmente pago', 'Antecipação parcialmente reembolsada', 'Antecipação totalmente reembolsada'];
function genAcelera(): string[] {
  const lines: string[] = [];
  lines.push(csvRow(['Relatório Shopee Acelera']));
  lines.push(csvRow(['Loja', 'lidermolduras']));
  lines.push(csvRow(['Período', '2026-07-01 a 2026-07-29']));
  lines.push(csvRow(['Entrada total de dinheiro', '253489.29']));
  lines.push(''); // linha em branco
  lines.push(csvRow(ACELERA_HEADERS)); // linha 6
  const redemptions = Array.from({ length: 5 }, () => `2193${pad(Math.floor(rnd() * 1e15), 15)}`);
  for (let i = 0; i < 295; i++) {
    const oid = orderId();
    const day = parseInt(oid.slice(4, 6), 10);
    const rid = redemptions[i % redemptions.length];
    const accel = 20 + rnd() * 200;
    const fee = accel * 0.02;
    lines.push(csvRow([
      dateWithTime(day),
      `="${rid}"`, // guarda de texto do Excel
      oid,
      moneyRS(accel + 5),
      '100%',
      moneyRS(accel),
      moneyRS(fee),
      moneyRS(accel - fee),
      moneyRS(0),
      moneyRS(0),
      moneyRS(accel + 5),
      moneyRS(0),
      pick(ACELERA_STATUS),
      dateWithTime(day),
      `2026-08-${pad(day, 2)}`,
    ]));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 7. AFILIADOS — COMISSÃO — CSV, cabeçalho linha 1. "Id de atribuição da
//    comissão" + "Estado de dedução". 43 linhas.
// ---------------------------------------------------------------------------
const COMMISSION_HEADERS = [
  'ID do pedido', 'Status do Pedido', 'Status verificado', 'Preço', 'Qtd', 'Nome do afiliado',
  'Id de atribuição da comissão', 'Valor da Compra', 'Valor do reembolso',
  'Comissão do item da marca para o Afiliado', 'Taxa de serviço de Afiliados do Vendedor', 'despesas',
  'Estado de dedução', 'Método de dedução', 'Período de cobrança da comissão', 'Número de referência SKU',
];
function genCommission(): string[] {
  const lines: string[] = [csvRow(COMMISSION_HEADERS)];
  for (let i = 0; i < 43; i++) {
    const oid = orderId();
    const purchase = 50 + rnd() * 300;
    const commission = purchase * 0.08;
    lines.push(csvRow([
      oid, 'Concluído', pick(['Verificado', 'Pendente']), money2(purchase / 2), '1',
      `afiliado_${i % 6}`, pad(81000000 + i, 8), money2(purchase), pick(['0.00', '--']),
      money2(commission), money2(commission * 0.1), '0.00',
      pick(['Deduzido', 'Pendente']), pick(['Carteira', 'Automático']),
      '2026-07', 'SKU-' + pad(1000 + i, 4),
    ]));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 8. AFILIADOS — PERFORMANCE — CSV, cabeçalho linha 1. Agregado, sem pedido.
//    "ID do Afiliado" + "ROI" + "Cliques". 7 linhas. ROI pode ser "--".
// ---------------------------------------------------------------------------
const PERFORMANCE_HEADERS = [
  'ID do Afiliado', 'Nome do afiliado', 'Nome de usuário do afiliado', 'Vendas(R$)',
  'Itens Brutos Vendidos', 'Pedidos', 'Cliques', 'Comissão estimada(R$)', 'ROI',
  'Total de compradores', 'Novos compradores',
];
function genPerformance(): string[] {
  const lines: string[] = [csvRow(PERFORMANCE_HEADERS)];
  for (let i = 0; i < 7; i++) {
    const sales = 500 + rnd() * 5000;
    lines.push(csvRow([
      pad(9000000 + i, 8), `Afiliado ${i}`, `afiliado_${i}`, money2(sales),
      String(10 + Math.floor(rnd() * 90)), String(5 + Math.floor(rnd() * 40)),
      String(50 + Math.floor(rnd() * 500)), money2(sales * 0.08),
      i === 0 ? '--' : (rnd() * 5).toFixed(2), String(Math.floor(rnd() * 30)), String(Math.floor(rnd() * 10)),
    ]));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Fixtures auxiliares para os testes obrigatórios (períodos sobrepostos e
// isolamento de erro). Cabeçalho na linha 1 para simplicidade.
// ---------------------------------------------------------------------------
function walletRow(day: number, oid: string, dir: string, amount: number, bal: number): unknown[] {
  return [
    `2026-07-${pad(day, 2)} 09:00:00`, 'Renda do pedido', `Pedido ${oid}`, oid,
    dir, money2(amount), 'Concluído', money2(bal), '',
  ];
}
/** Dois arquivos de carteira com K linhas IDÊNTICAS (período sobreposto). */
function genWalletOverlap(): { a: unknown[][]; b: unknown[][]; shared: number } {
  const shared: unknown[][] = [];
  for (let i = 0; i < 40; i++) {
    const oid = orderId();
    const day = 1 + (i % 15); // dias 1..15
    shared.push(walletRow(day, oid, i % 2 ? 'Saída' : 'Entrada', (i % 2 ? -1 : 1) * (10 + i), 5000 + i));
  }
  const uniqueA: unknown[][] = [];
  for (let i = 0; i < 30; i++) uniqueA.push(walletRow(1 + (i % 15), orderId(), 'Entrada', 100 + i, 6000 + i));
  const uniqueB: unknown[][] = [];
  for (let i = 0; i < 25; i++) uniqueB.push(walletRow(10 + (i % 11), orderId(), 'Saída', -(50 + i), 7000 + i));
  const a = [WALLET_HEADERS, ...shared, ...uniqueA];
  const b = [WALLET_HEADERS, ...shared, ...uniqueB]; // compartilha as 40 linhas
  return { a, b, shared: shared.length };
}

/** Pedidos com UMA linha inválida (sem ID) — erro isolado não invalida o lote. */
function genOrdersWithError(): unknown[][] {
  const rows: unknown[][] = [ORDERS_HEADERS];
  for (let i = 0; i < 6; i++) {
    const oid = i === 2 ? '' : orderId(); // a 3ª linha fica sem ID (erro)
    const row: unknown[] = new Array(ORDERS_HEADERS.length).fill('');
    row[0] = oid;
    row[1] = 'Concluído';
    row[7] = dateWithTime(10);
    row[16] = pick(PRODUCTS);
    row[17] = 'VAR-' + pad(500 + i, 3);
    row[21] = money2(100 + i);
    row[22] = '1';
    row[23] = money2(100 + i);
    row[42] = money2(100 + i);
    row[46] = money2(12);
    row[48] = money2(2);
    row[50] = money2(86);
    rows.push(row);
  }
  return rows;
}

function main() {
  ensureOut();
  writeXlsx('Order.toship.20260729.xlsx', 'orders', genOrders());
  writeXlsx('Order.cancelled.20260729.xlsx', 'orders', genCancellations());
  writeXlsx('Order.failed_delivery.20260729.xlsx', 'orders', genFailed());
  const ret = genReturns();
  writeXlsxAsXls('Order.return_refund.20260729.xls', 'Sheet1', ret.aoa); // .xls com conteúdo XLSX
  writeXlsx('my_balance_transaction_report.20260729.xlsx', 'Transaction Report', genWallet());
  writeCsv('2193537298992576518_1.csv', genAcelera());
  writeCsv('SellerOnlinePaymentValidationReport.20260729.csv', genCommission());
  writeCsv('AMSAffiliatePerformance.20260729.csv', genPerformance());

  const overlap = genWalletOverlap();
  writeXlsx('wallet_periodA.xlsx', 'Transaction Report', overlap.a);
  writeXlsx('wallet_periodB.xlsx', 'Transaction Report', overlap.b);
  writeXlsx('orders_with_one_error.xlsx', 'orders', genOrdersWithError());

  const manifest = {
    generatedBy: 'apps/api/test/fixtures/generate.ts',
    note: 'Fixtures SANITIZADAS que reproduzem a estrutura/volume dos relatórios reais (Bloco 0). Dados de demonstração.',
    repeatedReturnId: ret.repeatedReturnId,
    walletOverlapShared: overlap.shared,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const files = fs.readdirSync(OUT).filter((f) => f !== 'manifest.json');
  console.log('Fixtures geradas em', OUT);
  for (const f of files) {
    const size = fs.statSync(path.join(OUT, f)).size;
    console.log(`  ${f} (${size} bytes)`);
  }
}

main();
