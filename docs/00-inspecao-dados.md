# Bloco 0 — Inspeção e Contrato dos Dados

> Diagnóstico dos relatórios reais fornecidos pela Shopee.
> **Nenhum arquivo original foi alterado.** Os arquivos reais **não** são versionados
> (ver `.gitignore`). Todos os números abaixo vêm da leitura estrutural dos arquivos.

Período de referência dos arquivos: **01/07/2026 a 29/07/2026**.
Vendedor identificado nos metadados: `lidermolduras` (loja de molduras/quadros decorativos).

---

## 1. Inventário dos arquivos

| # | Relatório (fonte) | Arquivo | Formato real | Aba | Cabeçalho | Colunas | Linhas de dados | Chave principal |
|---|---|---|---|---|---|---|---|---|
| 1 | **Pedidos (a enviar)** | `Order.toship...xlsx` | XLSX | `orders` | linha 1 | 64 | 219 | `ID do pedido` |
| 2 | **Cancelamentos** | `Order.cancelled...xlsx` | XLSX | `orders` | linha 1 | 60 | 346 | `ID do pedido` |
| 3 | **Falha na entrega** | `Order.failed_delivery...xlsx` | XLSX | `orders` | linha 1 | 59 | 8 | `ID do pedido` |
| 4 | **Devoluções e reembolsos** | `Order.return_refund...xls` | **XLSX** (extensão `.xls` incorreta) | `Sheet1` | linha 1 | 46 | 150 (133 pedidos) | `ID da Devolução` |
| 5 | **Carteira Shopee** | `my_balance_transaction_report...xlsx` | XLSX | `Transaction Report` | **linha 18** (metadados nas linhas 1–17) | 9 | 232 | `ID do pedido` + `Data` |
| 6 | **Shopee Acelera** | `2193537298992576518_1.csv` | CSV | — | **linha 6** (metadados nas linhas 1–5) | 15 | 295 | `ID do pedido` |
| 7 | **Afiliados — Comissão/Validação** | `SellerOnlinePaymentValidationReport...csv` | CSV | — | linha 1 | 41 | 43 | `ID do pedido` + `Id de atribuição da comissão` |
| 8 | **Afiliados — Performance** | `AMSAffiliatePerformance...csv` | CSV | — | linha 1 | 11 | 7 | `ID do Afiliado` (**agregado, sem ID de pedido**) |

### Observações estruturais que impactam a importação (riscos)

1. **Extensão enganosa.** O arquivo de devoluções tem extensão `.xls`, mas o conteúdo é
   um ZIP OOXML (assinatura `PK\x03\x04`), ou seja, é um **XLSX**. O importador deve
   detectar o formato pelo **conteúdo (magic bytes)**, nunca só pela extensão.
2. **Linhas extras antes do cabeçalho.** Carteira (17 linhas de metadados) e Acelera
   (5 linhas de metadados + 1 linha em branco) exigem **detecção da linha de cabeçalho**,
   não `header=0` fixo.
3. **Blocos de resumo.** Carteira e Acelera trazem um bloco "Resumo" no topo com totais
   (ex.: `Entrada total de dinheiro = 253.489,29 / Saída = -253.594,26`). Esses totais
   são úteis para **auditoria** (conferir contra a soma das linhas), mas **não** são
   linhas de transação.
4. **Três formatos monetários diferentes** convivem entre os arquivos — ver seção 3.
5. **Coluna duplicada.** `Desconto do vendedor` aparece **duas vezes** (mesmo nome) nos
   relatórios de pedidos/cancelamentos/falhas. O importador deve indexar por **posição**,
   não só por nome, e preservar ambas no `rawPayload`.
6. **ID do resgate com "guarda" de texto.** No Acelera, o `ID do resgate rápido` vem como
   `="2193185766133548046"` (truque do Excel para não perder dígitos). Precisa de limpeza
   (`="..."` → dígitos).
7. **Dados pessoais.** Os relatórios de pedidos/devoluções contêm endereço completo, CEP,
   telefone (parcialmente mascarado) e nome do comprador. → **sanitização e não
   versionamento** (seção 5 do plano).

---

## 2. Formato dos IDs

- **ID do pedido**: 14 caracteres alfanuméricos maiúsculos. Ex.: `260722CC5B1RNV`,
  `2607194GVQKHVY`. Os 6 primeiros dígitos codificam a data (`AAMMDD` → `260722` = 22/07/2026).
- **ID da Devolução**: alfanumérico de 15 caracteres. Ex.: `2607010HKU4BFDS`.
- **ID do resgate rápido (Acelera)**: numérico longo (19 dígitos). Ex.: `2193185766133548046`.
  Apenas **5 IDs de resgate distintos** agrupam os **295 pedidos** → um resgate em lote
  cobre muitos pedidos (relação 1‑resgate → N‑pedidos).
- **Id de atribuição da comissão (Afiliados)**: numérico de 8 dígitos. Ex.: `81272667`.

---

## 3. Formatos monetários e de data (normalização obrigatória)

| Fonte | Exemplo de valor | Regra de parsing |
|---|---|---|
| Pedidos / Cancelamentos / Falhas | `58.00`, `689.00`, `-` (vazio) | ponto decimal, sem símbolo |
| Carteira | `-44.31`, `-0.64` | ponto decimal, **sinal** indica direção |
| Shopee Acelera | `R$99.54`, `R$1749.23` | prefixo `R$` + **ponto** decimal |
| Devoluções | `R$331,08`, `R$0,00` | prefixo `R$` + **vírgula** decimal (padrão BR) |
| Afiliados (ambos) | `86.19`, `507`, `--` (nulo) | ponto decimal; `--` e vazio = nulo |

> **Regra**: normalizar tudo para `Decimal` (nunca `float`), preservando o texto bruto no
> `rawPayload`. O importador precisa de parsers específicos por relatório porque o mesmo
> conceito ("valor de reembolso") vem em `R$331,08` num arquivo e em `-44.31` noutro.

**Datas** aparecem em três granularidades ISO-like:
`2026-07-28 10:38:41` (data+hora+seg), `2026-07-17 21:46` (data+hora), `2026-07-01` (só data).
Todas em fuso do Brasil. Diferenciar **data do evento** × **data da importação** × **data da conciliação**.

---

## 4. Campos por relatório (cabeçalhos exatos)

### 4.1 Pedidos a enviar (64 col) — schema-mãe dos pedidos
`ID do pedido · Status do pedido · Hot Listing · Status da Devolução / Reembolso ·
Número de rastreamento · Opção de envio · Método de envio · Data de criação do pedido ·
Hora do pagamento do pedido · Data prevista de envio · Tempo de Envio · Domestic Delivered Date ·
Hora completa do pedido · Data da Finalização do Cancelamento · Pedido FBS ·
Nº de referência do SKU principal · Nome do Produto · Número de referência SKU · Nome da variação ·
Shopee Owned · Preço original · Preço acordado · Quantidade · Subtotal do produto ·
**Desconto do vendedor · Desconto do vendedor** (duplicado) · Incentivo Shopee para ação comercial ·
Ajuste por participação em ação comercial · Peso total SKU · Número de produtos pedidos ·
Peso total do pedido · Código do Cupom · Cupom do vendedor · Coin Cashback Voucher... ·
Cupom · Incentivo de cupom · Ajuste por pagamento via PIX · Indicador da Leve Mais por Menos ·
Desconto Shopee da Leve Mais por Menos · Desconto da Leve Mais por Menos do vendedor ·
Compensar Moedas Shopee · Total descontado Cartão de Crédito · **Valor Total** ·
Taxa de envio pagas pelo comprador · Taxa de Envio Reversa · **Taxa de transação** ·
**Taxa de comissão bruta · Taxa de comissão líquida · Taxa de serviço bruta · Taxa de serviço líquida** ·
Total global · Valor estimado do frete · Nome de usuário (comprador) · Nome do destinatário ·
Telefone · Endereço de entrega · Cidade · Bairro · Cidade · UF · País · CEP ·
Observação do comprador · Nota`

### 4.2 Cancelamentos (60 col)
Mesmo schema dos pedidos, **sem** as colunas de taxa bruta/líquida separadas e **com**
a coluna extra **`Cancelar Motivo`** (ex.: *"Cancelado automaticamente… Motivo: Pedido não pago"*).
Nos cancelados, os campos financeiros (`Valor Total`, taxas) vêm **zerados**.

### 4.3 Falha na entrega (59 col)
Mesmo schema dos pedidos, **sem** `Cancelar Motivo`. Status observado: `Cancelado`.
Volume pequeno (8 linhas). Financeiro zerado.

### 4.4 Devoluções e reembolsos (46 col)
`ID da Devolução · ID do pedido · Data de criação do pedido · Nome de usuário (Comprador) ·
Nome do Produto · SKU principal · Nome da variação · SKU da Variação · IMEI · Preço da unidade ·
Tempo de envio de devolução · Status da Devolução / Reembolso · Tipo de Devolução ·
Quantidade de Devoluções · Solução para Retorno e Reembolso · Motivo da Devolução ·
Observações da Devolução · **Quantia total de reembolsos** · Tempo decorrido de reembolso ·
Retorno ao Armazém Shopee · Opção de envio de devolução · Número de rastreamento de devolução ·
Status de rastreamento de devolução · Tempo de entrega de devolução concluída ·
Endereço de entrega · UF · Cidade · CEP · Telefone · Endereço de coleta de devolução ·
Estado · Cidade · CEP · Buyer contact number · Ação do Vendedor solicitada até ·
Motivo da disputa · Observação do vendedor ·
**Compensação ao Vendedor (Disputa bem sucedida/Ajuste em carteira)** · Opção de Entrega ·
Tipo de Estoque · Número de rastreio · **Valor pago pelo comprador** · Método de pagamento ·
Observação do Comprador · Hot Listing · Motivo da devolução revisado`

### 4.5 Carteira Shopee (9 col) — extrato financeiro
`Data · Tipo de transação · Descrição · ID do pedido · Direção do dinheiro · Valor ·
Status · Balança após as transações · Valor a Ser Ajustado`

Distribuição por **Tipo de transação** (232 linhas): `Shopee Acelera` 160 · `Ajuste` 32 ·
`Renda do pedido` 19 · `Pix` 12 · `Saques` 9. Direção: `Saída` 183 · `Entrada` 49.
**100% das linhas têm `ID do pedido`** preenchido neste arquivo (mas o modelo deve permitir vazio).
Descrição típica de reembolso: *"Débito referente ao pedido `<id>` devido à solicitação de
reembolso / devolução e reembolso aprovado"*.

### 4.6 Shopee Acelera (15 col)
`Data do resgate rápido · ID do resgate rápido · ID do pedido ·
Valor de pedidos disponível para resgate rápido · Percentual de resgate rápido ·
Valor dos resgates rápidos · Taxa de Serviço · Valor recebido · Valor restante para pagamento ·
Valor reembolsado · Faturamento total do pedido · Valor pendente · Status ·
Data da última transação · Data de vencimento`
Status: `Antecipação paga` 231 · `Totalmente pago` 44 · `Antecipação parcialmente reembolsada` 19 ·
`Antecipação totalmente reembolsada` 1.

### 4.7 Afiliados — Comissão/Validação (41 col)
Nível de pedido. Campos-chave: `ID do pedido · Status do Pedido · Status verificado · Preço · Qtd ·
Nome do afiliado · Id de atribuição da comissão · Valor da Compra · Valor do reembolso ·
Comissão do item da marca para o Afiliado · Taxa de serviço de Afiliados do Vendedor · despesas ·
Estado de dedução · Método de dedução · Período de cobrança da comissão` (+ categorias globais L1/L2/L3).

### 4.8 Afiliados — Performance (11 col) — **agregado, sem pedido**
`ID do Afiliado · Nome do afiliado · Nome de usuário do afiliado · Vendas(R$) ·
Itens Brutos Vendidos · Pedidos · Cliques · Comissão estimada(R$) · ROI ·
Total de compradores · Novos compradores`. É um **resumo por afiliado** → fonte de auditoria,
não conciliável por pedido.

---

## 5. Mapa: Relatório → Campos → Tabela → Chave de dedup → Relação com o pedido

| Relatório | Campos normalizados (principais) | Tabela(s) de destino | Chave de deduplicação | Relação com o pedido |
|---|---|---|---|---|
| Pedidos a enviar | preço original/acordado, taxas, status, itens | `Order` + `OrderItem` | `(marketplaceAccountId, externalOrderId, variationSku)` | **é** o pedido |
| Cancelamentos | motivo, data de cancelamento | `OrderCancellation` (+ upsert de `Order`) | `(marketplaceAccountId, externalOrderId)` | 1:1 com pedido |
| Falha na entrega | motivo, rastreio, data | `FailedDelivery` (+ upsert de `Order`) | `(marketplaceAccountId, externalOrderId, trackingCode)` | 1:1 com pedido |
| Devoluções/Reembolsos | valor solicitado, compensação, valor pago, status | `ReturnRefund` | `(marketplaceAccountId, externalReturnId)` | 1:N (um pedido pode ter várias devoluções) |
| Carteira | tipo, valor, direção, saldo | `WalletTransaction` | `(marketplaceAccountId, occurredAt, transactionType, amount, externalOrderId)` ou hash da linha | 0/1/N pedidos |
| Shopee Acelera | valor antecipado, taxa, reembolsado, pendente | `AccelerationEvent` | `(marketplaceAccountId, externalRedemptionId, externalOrderId)` | N eventos por pedido; 1 resgate → N pedidos |
| Afiliados — Comissão | comissão, taxa serviço, dedução | `AffiliateCommission` | `(marketplaceAccountId, externalOrderId, externalCommissionAttributionId)` | 1:N por pedido |
| Afiliados — Performance | vendas, cliques, ROI | `AffiliatePerformanceSnapshot` (auditoria) | `(marketplaceAccountId, affiliateId, periodStart, periodEnd)` | **não** liga a pedido |

---

## 6. Descoberta mais importante para a conciliação

Num **snapshot único**, a interseção de `ID do pedido` **entre** relatórios é baixa, porque
cada relatório é um **recorte temporal e de estágio de ciclo de vida diferente**:

| Interseção de IDs de pedido | Resultado |
|---|---|
| Devoluções ∩ Carteira | **24** de 133 devoluções têm débito localizado na carteira |
| Devoluções sem débito na carteira | **109** (esperam evento financeiro → pendência `WAITING_FOR_DATA`) |
| Comissão de afiliados ∩ Carteira | **3** de 43 |
| Acelera ∩ Carteira | **3** de 295 |
| Pedidos "a enviar" ∩ (qualquer financeiro) | ~0 (são pedidos recém-criados, ainda sem liquidação) |

**Conclusão:** a conciliação **não** fecha num único dia/arquivo. Ela **ganha densidade
conforme os relatórios acumulam** ao longo das semanas. Por isso o sistema precisa de:
(a) uma **classificação temporal** que distingue *ausência ainda esperada* de *falta real*
(`NOT_YET_EXPECTED` · `WAITING_COMPLEMENTARY_PERIOD` · `WAITING_FOR_MARKETPLACE` ·
`OVERDUE_DIVERGENCE` · `REAL_PENDENCY` — ver `arquitetura-e-plano.md` §5.1), de modo que **só
falta real** entra na fila operacional; (b) **reprocessamento** a cada novo arquivo, que reavalia
a situação temporal; (c) **nunca** forçar vínculo aproximado para "fechar" a conta.

> Importante: a baixa interseção observada **não** deve virar, na importação, uma enxurrada de
> pendências. Um evento cujo prazo de liquidação ainda não venceu, ou cujo período nem foi
> importado, é *ausência esperada* — não problema. O sistema só promove a pendência real quando
> vence a **janela de tolerância** do tipo de evento.
