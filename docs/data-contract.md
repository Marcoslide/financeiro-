# Contrato de Dados (`data-contract.md`)

Este documento é a **fonte de verdade** para os importadores. Para cada relatório define:
cabeçalhos esperados, aliases aceitos, tipo, obrigatoriedade, transformação, tabela de
destino, chave de deduplicação e relacionamento.

Convenções de tipo:
- `decimal` → sempre `Decimal` (nunca float). Preserva a moeda (BRL).
- `datetime` → normalizado para timestamp com timezone `America/Sao_Paulo`.
- `string` → texto preservado como veio no `rawPayload`.
- `id` → identificador externo tratado como string (nunca número).

Regra geral: **toda linha guarda o payload bruto** (`rawPayload` JSON) mesmo que apenas
parte dos campos seja normalizada na primeira versão. Nenhuma coluna é descartada.

---

## Detecção de relatório

O importador identifica o tipo pelo **conjunto de cabeçalhos** (assinatura), não pelo nome
do arquivo. Detecção pelo conteúdo, com fallback para seleção manual.

| reportType | Assinatura (cabeçalhos presentes) | Cabeçalho na linha |
|---|---|---|
| `ORDERS` | `ID do pedido` + `Preço acordado` + `Taxa de comissão líquida` | 1 |
| `ORDER_CANCELLATION` | `ID do pedido` + `Cancelar Motivo` | 1 |
| `FAILED_DELIVERY` | `ID do pedido` + `Status do pedido` **sem** `Cancelar Motivo` **e** origem = failed_delivery | 1 |
| `RETURN_REFUND` | `ID da Devolução` + `Quantia total de reembolsos` | 1 |
| `WALLET_TRANSACTION` | `Tipo de transação` + `Direção do dinheiro` + `Balança após as transações` | **detectar** (≈18) |
| `SHOPEE_ACELERA` | `ID do resgate rápido` + `Valor dos resgates rápidos` | **detectar** (≈6) |
| `AFFILIATE_COMMISSION` | `Id de atribuição da comissão` + `Estado de dedução` | 1 |
| `AFFILIATE_PERFORMANCE` | `ID do Afiliado` + `ROI` + `Cliques` | 1 |

> `FAILED_DELIVERY` e `ORDER_CANCELLATION` compartilham quase todo o schema. Como ambos
> podem trazer status `Cancelado`, a distinção final usa a **origem declarada na importação**
> (o usuário seleciona o tipo quando a detecção não for 100% segura). A presença de
> `Cancelar Motivo` desempata a favor de `ORDER_CANCELLATION`.

---

## 1. ORDERS → `Order` + `OrderItem`

| Campo origem | Alias aceitos | Tipo | Obrig. | Transformação | Destino |
|---|---|---|---|---|---|
| ID do pedido | order id | id | sim | trim | `Order.externalOrderId` |
| Status do pedido | | string | sim | — | `Order.status` |
| Status da Devolução / Reembolso | | string | não | — | `Order.returnRefundStatus` |
| Data de criação do pedido | | datetime | sim | parse BR/ISO | `Order.createdAtMarketplace` |
| Hora do pagamento do pedido | | datetime | não | `-`→null | `Order.paidAt` |
| Pedido FBS | | bool | não | Yes/No | `Order.isFbs` |
| Preço original | | decimal | sim | ponto | `OrderItem.originalUnitPrice` |
| Preço acordado | | decimal | sim | ponto | `OrderItem.negotiatedUnitPrice` / `Order.negotiatedAmount` |
| Quantidade | | int | sim | — | `OrderItem.quantity` |
| Subtotal do produto | | decimal | sim | ponto | `OrderItem.subtotal` |
| Desconto do vendedor (1ª ocorrência) | | decimal | não | **preservar; NÃO virar despesa/DRE** | `OrderItem.sellerDiscount` |
| Desconto do vendedor (2ª ocorrência) | | decimal | não | preservar no rawPayload | `rawPayload` |
| Número de referência SKU | | string | não | — | `OrderItem.variationSku` |
| Nº de referência do SKU principal | | string | não | — | `OrderItem.parentSku` |
| Nome do Produto | | string | sim | — | `OrderItem.productName` |
| Valor Total | | decimal | não | ponto | `Order.buyerPaidAmount` |
| Taxa de transação | | decimal | não | ponto | fee (transação) |
| Taxa de comissão líquida | | decimal | não | ponto | fee (comissão) |
| Taxa de serviço líquida | | decimal | não | ponto | fee (serviço) |
| Total global | | decimal | não | ponto | `Order.estimatedReceivable` |
| Nome do destinatário / Telefone / Endereço / CEP | | string | não | **sanitizar** (dado pessoal) | `rawPayload` (restrito) |

**Chave de dedup:** `(marketplaceAccountId, externalOrderId, variationSku)` no item;
`(marketplaceAccountId, externalOrderId)` no pedido. **Upsert idempotente.**

> **Regra do desconto do vendedor** (seção 4 do prompt): o `Preço acordado` **já é** o valor
> negociado. O `Desconto do vendedor` é estratégia comercial (preço cheio inflado). Preserva-se
> o campo, mas **não** se reduz a receita de novo por ele nem se joga automaticamente na DRE.

---

## 2. ORDER_CANCELLATION → `OrderCancellation`

| Campo origem | Tipo | Obrig. | Destino |
|---|---|---|---|
| ID do pedido | id | sim | `externalOrderId` |
| Cancelar Motivo | string | sim | `reason` |
| Data da Finalização do Cancelamento | datetime | não | `cancelledAt` |
| Status do pedido | string | sim | `status` |

**Dedup:** `(marketplaceAccountId, externalOrderId)`. Também faz **upsert de `Order`**
(status `Cancelado`). Financeiro vem zerado; não gera receita.

---

## 3. FAILED_DELIVERY → `FailedDelivery`

| Campo origem | Tipo | Obrig. | Destino |
|---|---|---|---|
| ID do pedido | id | sim | `externalOrderId` |
| Número de rastreamento | string | não | `trackingCode` |
| Data da Finalização do Cancelamento | datetime | não | `occurredAt` |
| Status do pedido | string | sim | `status` |

**Dedup:** `(marketplaceAccountId, externalOrderId, trackingCode)`.
**Falha na entrega ≠ cancelamento automático** — o motor aguarda o evento financeiro correspondente.

---

## 4. RETURN_REFUND → `ReturnRefund`

| Campo origem | Tipo | Obrig. | Transformação | Destino |
|---|---|---|---|---|
| ID da Devolução | id | sim | trim | `externalReturnId` |
| ID do pedido | id | sim | trim | `externalOrderId` |
| Status da Devolução / Reembolso | string | sim | — | `status` |
| Tipo de Devolução | string | não | — | `returnType` |
| Solução para Retorno e Reembolso | string | não | — | `resolution` |
| Motivo da Devolução | string | não | — | `originalReason` |
| Motivo da devolução revisado | string | não | — | `reviewedReason` |
| Quantidade de Devoluções | int | não | — | `returnedQuantity` |
| Quantia total de reembolsos | decimal | sim | **`R$1.234,56`→Decimal** | `requestedRefundAmount` |
| Compensação ao Vendedor (…Ajuste em carteira) | decimal | não | `R$…,..`→Decimal | `sellerCompensationAmount` |
| Valor pago pelo comprador | decimal | não | `R$…,..`→Decimal | `buyerPaidAmount` |
| Status de rastreamento de devolução | string | não | — | `returnTrackingStatus` |

**Dedup e histórico (modelo em 3 níveis — ver §9.2):**
- **Processo de devolução** (`ReturnRefund`): chave `(marketplaceAccountId, externalReturnId)`.
  Relação **1:N** com o pedido (um pedido pode ter várias devoluções).
- **Eventos da devolução** (`ReturnRefundEvent`): cada linha importada vira um evento
  imutável, deduplicado por **hash canônico** `(externalReturnId · status · resolution ·
  requestedRefundAmount · sellerCompensationAmount · returnTrackingStatus · observedAt)`.
- **Snapshot mais recente**: campos correntes do processo (status/valor/solução) apontam
  para o **último evento** observado.

> ⚠️ **Nunca sobrescrever silenciosamente** o histórico quando status, valor ou solução mudar.
> Quando a mesma `externalReturnId` reaparece com status diferente (ex.: *Solicitação cancelada*
> → *Reembolso aprovado*), registra-se um **novo evento** e atualiza-se o snapshot, preservando
> o anterior. `requestedRefundAmount` (solicitado) **é diferente** do valor efetivamente debitado
> na carteira — nunca tratar solicitação como prejuízo confirmado.

---

## 5. WALLET_TRANSACTION → `WalletTransaction`

| Campo origem | Tipo | Obrig. | Transformação | Destino |
|---|---|---|---|---|
| Data | datetime | sim | parse | `occurredAt` |
| Tipo de transação | string | sim | — | `transactionType` |
| Descrição | string | não | — | `description` |
| ID do pedido | id | não | trim (pode ser vazio) | `externalOrderId` |
| Direção do dinheiro | enum | sim | `Entrada`/`Saída` | define crédito/débito |
| Valor | decimal | sim | ponto, com sinal | `creditAmount`/`debitAmount` + `netAmount` |
| Status | string | não | — | `status` |
| Balança após as transações | decimal | não | ponto | `balanceAfter` |
| Valor a Ser Ajustado | decimal | não | ponto | `adjustmentAmount` |

**Dedup (ordem de precedência — ver §9):**
1. identificador externo da movimentação, **se existir** no arquivo (não presente nos arquivos
   inspecionados até agora, mas o modelo reserva `externalTransactionId`);
2. referência externa completa, se existir;
3. conjunto determinístico dos campos originais;
4. **hash canônico da linha** como *fallback* (§9.1).

> ⚠️ **Nunca** usar `(orderId, data, valor)` como identidade. Um mesmo pedido pode ter, no
> mesmo dia, crédito + débito + reembolso + compensação + ajuste + tarifa + antecipação —
> todas legítimas. O hash canônico da carteira inclui, no mínimo:
> `occurredAt (com segundos) · transactionType · moneyDirection · amount · externalOrderId ·
> description · balanceAfter · adjustmentAmount · status`. O `balanceAfter` (saldo após a
> transação) é um discriminador forte porque é único na sequência do extrato.

**Livro financeiro** — não sobrescrever de forma destrutiva; nunca apagar uma linha só porque
ela não reaparece num arquivo posterior (§9.4).
`transactionType ∈ {Shopee Acelera, Ajuste, Renda do pedido, Pix, Saques}` (observados).

---

## 6. SHOPEE_ACELERA → `AccelerationEvent`

| Campo origem | Tipo | Obrig. | Transformação | Destino |
|---|---|---|---|---|
| Data do resgate rápido | datetime | sim | parse | `requestDate` |
| ID do resgate rápido | id | sim | **`="123"`→`123`** | `externalRedemptionId` |
| ID do pedido | id | sim | trim | `externalOrderId` |
| Valor de pedidos disponível para resgate | decimal | não | `R$` ponto | `availableAmount` |
| Percentual de resgate rápido | decimal | não | `100%`→1.0 | `accelerationPercentage` |
| Valor dos resgates rápidos | decimal | sim | `R$` ponto | `acceleratedAmount` |
| Taxa de Serviço | decimal | não | `R$` ponto | `feeAmount` |
| Valor recebido | decimal | não | `R$` ponto | `netReceivedAmount` |
| Valor reembolsado | decimal | não | `R$` ponto | `refundedAmount` |
| Valor pendente | decimal | não | `R$` ponto | `pendingAmount` |
| Data de vencimento | datetime | não | parse | `maturityDate` |
| Status | string | sim | — | `status` |

**Dedup (ordem de precedência — ver §9):**
1. `externalRedemptionId` (ID do resgate) + `externalOrderId`, **quando o par identifica um
   único evento**;
2. ID do evento, se o arquivo trouxer (reservado: `externalEventId`);
3. `externalOrderId` + `tipo/status do evento` + `requestDate` + referência;
4. **hash canônico da linha** como *fallback* (§9.1).

> ⚠️ **Nunca** deduplicar só por `externalOrderId`. Um pedido pode ter mais de um evento,
> resgate ou ajuste de antecipação (observado: status varia entre *paga*, *parcialmente
> reembolsada*, *totalmente reembolsada* para o mesmo fluxo). Um **resgate** cobre **N pedidos**
> (5 resgates → 295 pedidos); e um **pedido** pode aparecer em **N eventos** ao longo do tempo.
> O hash canônico inclui: `externalRedemptionId · externalOrderId · requestDate · status ·
> acceleratedAmount · feeAmount · refundedAmount · pendingAmount · maturityDate`.

---

## 7. AFFILIATE_COMMISSION → `AffiliateCommission`

| Campo origem | Tipo | Obrig. | Destino |
|---|---|---|---|
| ID do pedido | id | sim | `externalOrderId` |
| Id de atribuição da comissão | id | sim | `externalCommissionAttributionId` |
| Status verificado | string | não | `verificationStatus` |
| Valor da Compra | decimal | não | `purchaseAmount` |
| Valor do reembolso | decimal | não | `refundAmount` |
| Comissão do item da marca para o Afiliado | decimal | não | `affiliateCommission` |
| Taxa de serviço de Afiliados do Vendedor | decimal | não | `serviceFee` |
| despesas | decimal | não | `expenses` |
| Estado de dedução | string | não | `deductionStatus` |
| Método de dedução | string | não | `deductionMethod` |
| Período de cobrança da comissão | datetime | não | `billingPeriod` |

**Dedup (nível real da linha — a planilha é por atribuição/item de comissão):**
chave composta por **todos** os discriminadores presentes:
`externalCommissionAttributionId · externalOrderId · (externalProductId/externalModelId ou
variationSku) · afiliado (username) · campanha · período de cobrança · tipo do evento`.
Fallback: **hash canônico da linha** (§9.1).

> ⚠️ **Nunca colapsar** várias comissões legítimas do mesmo pedido. O mesmo `externalOrderId`
> pode ter comissões de itens/afiliados/campanhas diferentes, e o mesmo par
> `(orderId, attributionId)` pode reaparecer com valores atualizados (verificação/dedução) —
> nesse caso é **atualização** do registro existente (§9.3), não um novo registro.
> Todos os demais campos da planilha preservados no `rawPayload`.

---

## 8. AFFILIATE_PERFORMANCE → `AffiliatePerformanceSnapshot` (auditoria)

| Campo origem | Tipo | Destino |
|---|---|---|
| ID do Afiliado | id | `affiliateId` |
| Nome de usuário do afiliado | string | `affiliateUsername` |
| Vendas(R$) | decimal | `salesAmount` |
| Pedidos | int | `orders` |
| Cliques | int | `clicks` |
| Comissão estimada(R$) | decimal | `estimatedCommission` |
| ROI | decimal | `roi` (`--`→null) |

**Dedup:** `(marketplaceAccountId, affiliateId, periodStart, periodEnd)`.
Agregado por afiliado, **sem** ID de pedido → não entra na conciliação por pedido; serve de
**auditoria de totais** de comissão.

---

## 9. Deduplicação, atualização, snapshots e sobreposição de períodos

Princípio-guia: **num sistema financeiro, deduplicar errado é pior do que não conciliar.**
Uma chave curta demais pode descartar um débito/crédito legítimo. Por isso, toda entidade tem
uma **cadeia de identidade** (do identificador mais forte ao hash canônico) e uma **política de
atualização** que separa o que é *imutável* do que é *mutável*.

### 9.1 Hash canônico (fallback universal)
Quando não há identificador externo confiável, a identidade da linha é
`sha256(canonical)`, onde `canonical` é a concatenação **ordenada e normalizada** dos campos
originais **relevantes** daquele relatório (valores em `Decimal` com escala fixa, datas em ISO
com timezone, strings *trim*). O conjunto de campos é definido **por relatório** (ver as caixas
⚠️ em §4–§7) e deve ser suficiente para distinguir **duas linhas legítimas do mesmo pedido no
mesmo dia**. O hash é armazenado em `dedupHash` e indexado por conta. Reimportar a mesma linha
gera o mesmo hash → é ignorada (não duplica dinheiro).

### 9.2 Imutável vs mutável (livro-razão + snapshot)
- **Eventos financeiros são imutáveis** (`WalletTransaction`, `AccelerationEvent`,
  `ReturnRefundEvent`, `AffiliateCommission` como linha de origem). Nunca são reescritos nem
  apagados; formam o livro-razão.
- **Entidades "de estado" carregam um snapshot** que aponta para o evento mais recente
  (`ReturnRefund` → último `ReturnRefundEvent`; `Order` → resumo corrente). O snapshot é
  atualizado; o histórico é preservado em eventos + `AuditLog`.

### 9.3 Política de atualização (quando um registro reaparece)
| Situação | Ação |
|---|---|
| Linha idêntica (mesmo `dedupHash`) | ignora (duplicata) |
| Mesma chave natural, **campos mutáveis** mudaram (status, valor aprovado, dedução) | cria **novo evento** + atualiza snapshot; registra `AuditLog(before/after)` |
| Mesma chave natural, **campos imutáveis** divergem (data/valor de um evento já gravado) | **não** sobrescreve: gera pendência `duplicidade`/`divergência` para revisão manual |
| Chave nova | insere |

Todo registro guarda `firstSeenBatchId` e `lastSeenBatchId` (§9.4).

### 9.4 Sobreposição de períodos (reimportar 01–10 e depois 05–15)
O sistema **precisa** aceitar períodos sobrepostos sem duplicar. Regras:
- reconhecer eventos já existentes pelo `dedupHash`/chave e **inserir só os novos**;
- **preservar** os anteriores;
- atualizar apenas registros **mutáveis** quando houver evidência (§9.3);
- gravar `lastSeenBatchId` = lote mais recente em que o dado foi observado;
- **nunca apagar** um evento porque ele deixou de aparecer num arquivo posterior (um arquivo de
  05–15 não "remove" um evento de 02, apenas não o contém).

### 9.5 Precedência de fontes (mesma informação em fontes diferentes)
Quando o mesmo fato aparece em mais de uma fonte, a **confirmação financeira** vem sempre da
carteira. Ordem de confiança do valor:
1. **Carteira** (dinheiro efetivamente movimentado) — fonte da verdade financeira;
2. relatório específico do evento (Devoluções, Acelera, Afiliados) — valor *previsto/solicitado*;
3. resumo/agregado (Performance de afiliados, blocos "Resumo") — auditoria de totais.
Ex.: o *reembolso solicitado* (Devoluções) só vira *prejuízo confirmado* quando há o **débito
correspondente na carteira**. Enquanto não houver, é situação temporal (ver
`arquitetura-e-plano.md` §5.1), não pendência real.

---

## Sanitização (dados pessoais)

Campos `Nome do destinatário`, `Telefone`, `Endereço de entrega`, `CEP`, `Nome de usuário
(comprador)` só entram no `rawPayload` com acesso restrito e **nunca** em logs. Fixtures de
teste usam versões sanitizadas. Arquivos reais ficam no `.gitignore`.
