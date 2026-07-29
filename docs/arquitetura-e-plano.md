# Arquitetura, Modelo de Dados e Plano de Execução

Sistema de **conciliação financeira da Shopee**. Foco exclusivo: reconstruir a história
financeira de cada pedido cruzando os relatórios. **Não** é ERP, **não** é gestor de
devoluções — devoluções/afiliados/Acelera/cancelamentos/falhas são **fontes** que explicam
o resultado financeiro.

---

## 1. Stack

| Camada | Tecnologia | Motivo |
|---|---|---|
| Frontend | Next.js + TypeScript | telas profissionais, tabelas/filtros/modais |
| Backend | NestJS + TypeScript | módulos, DTOs, validação, erros padronizados |
| Banco | PostgreSQL | transações, integridade |
| ORM | Prisma | migrações, tipagem, `Decimal` nativo |
| Fila (quando necessário) | Redis + BullMQ | importações grandes / reprocessamento assíncrono |
| Arquivos | disco local (dev) com abstração p/ S3 | preparação p/ nuvem |
| Testes | Vitest/Jest | importadores, conciliação, idempotência, isolamento |

Monorepo (`apps/web`, `apps/api`, `packages/shared`). Docker Compose para Postgres+Redis em dev.

---

## 2. Fluxo do núcleo (única porta de entrada)

```
Planilha (MANUAL_UPLOAD)  ─┐
API interna (INTERNAL_...) ─┼─► recepção ─► armazenamento BRUTO ─► validação ─►
API oficial (SHOPEE_...)  ─┘     (ImportBatch/ImportRow)

  ─► normalização ─► deduplicação ─► conciliação ─► pendências ─► relatórios
```

Toda fonte alimenta o **mesmo** pipeline. A API **nunca** escreve direto nas tabelas finais
sem passar por validação/normalização/dedup.

---

## 3. Modelo de dados (proposta final)

Ajustado à inspeção real. `Decimal(18,2)` para dinheiro; `Decimal(18,6)` para percentuais/pesos.

### Multiloja / organização
- `Organization(id, name, status, timestamps)`
- `MarketplaceAccount(id, organizationId, marketplace, displayName, shopId, sellerId, currency, timezone, status, timestamps)` — vendedor `lidermolduras` vira uma conta.
- `MarketplaceConnection(id, marketplaceAccountId, sourceType, connectionStatus, encryptedCredentials, tokenExpiresAt, lastSyncAt, lastSuccessfulSyncAt, lastError, timestamps)`

### Importação
- `ImportBatch(id, organizationId, marketplaceAccountId, reportType, ingestionSource, originalFilename, storagePath, fileHash, periodStart, periodEnd, status, totalRows, validRows, importedRows, updatedRows, duplicatedRows, warningRows, failedRows, startedAt, completedAt, createdByUserId, timestamps)`
- `ImportRow(id, importBatchId, rowNumber, externalOrderId, externalReference, rawPayload Json, normalizedPayload Json?, processingStatus, errorCode, errorMessage, timestamps)`

### Pedidos e itens
- `Order(...)` — inclui `grossAmount, negotiatedAmount, buyerPaidAmount, sellerDiscountAmount, estimatedReceivable, status, paymentStatus, shippingStatus, returnRefundStatus, isFbs, currency, rawSummary`.
- `OrderItem(...)` — `originalUnitPrice, negotiatedUnitPrice, subtotal, sellerDiscount, parentSku, variationSku, quantity, weight`.

### Produtos, SKU, categoria, custo (com vigência)
- `Product`, `Sku(internalCategoryId?)`, `InternalCategory`, `CategoryCost(amount, validFrom, validUntil)`.
- `OrderItemCostSnapshot` — **congela** o custo aplicado ao pedido (custo depende da
  **categoria interna**, não da imagem vendida). Alterar custo depois **não** reescreve pedidos antigos.

### Eventos financeiros (um por fonte) — **imutáveis**
- `WalletTransaction`, `AccelerationEvent`, `AffiliateCommission`,
  `OrderCancellation`, `FailedDelivery`, `AffiliatePerformanceSnapshot`, `WeeklyIncomeStatement`.
- **Devolução em 3 níveis** (evita sobrescrita silenciosa — `data-contract.md` §9.2):
  - `ReturnRefund` (processo; chave `returnId`; guarda o **snapshot** corrente e aponta o último evento);
  - `ReturnRefundEvent` (cada linha importada; imutável; um novo evento a cada mudança de status/valor);
- Cada evento guarda **origem e rastreamento**: `importRowId`, `importBatchId`, `ingestionSource`,
  `externalId`, `rawPayload`, `dedupHash`, `firstSeenBatchId`, `lastSeenBatchId`, `observedAt`.

### Produtos, custos e classificação (respostas §8.1 e §8.2)
- `InternalCategory`, `CategoryCost(amount, validFrom, validUntil, notes)` — custo por vigência.
- `SkuClassification(skuId, internalCategoryId, method[MANUAL|RULE_APPROVED], ruleId?, createdByUserId, timestamps)`
  + `SkuClassificationHistory` — vínculo SKU→categoria feito na tela, com histórico e alteração posterior.
- `ClassificationRuleSuggestion(pattern, matchType[PREFIX|REGEX], suggestedCategoryId, status[PENDING|APPROVED|REJECTED])`
  — sugestão por prefixo/padrão, **sem** classificação automática irreversível (usuário aprova).
- `OrderItemCostSnapshot` — **congela** o custo aplicado ao pedido; alterar custo depois não reescreve pedidos antigos.

### Conciliação
- `OrderReconciliation(orderId, state, temporalStatus, completeness, reconciledAmount, unexplainedAmount, toleranceDeadline, lastAttemptAt)` — `temporalStatus` conforme §5.1
- `ReconciliationLink(id, orderId?, eventType, eventId, linkType[AUTO|MANUAL], confidence, ruleId, justification, createdByUserId, timestamps)`
- `Pendency(id, type, priority, status, orderId?, amount, source, assigneeId?, suggestion, ageDays, history Json, lastAutoAttemptAt, timestamps)`
- `AuditLog(id, organizationId, userId, action, entityType, entityId, beforePayload, afterPayload, metadata, createdAt)`

### Usuários
- `User(role ∈ ADMIN|FINANCIAL|VIEWER)` + auth. Credenciais/tokens **criptografados**, nunca em log.

---

## 4. Regras de deduplicação (idempotência)

> **Princípio:** num sistema financeiro, **deduplicar errado é pior do que não conciliar**.
> Nenhuma chave pode ser curta a ponto de descartar um débito/crédito legítimo. Cada entidade
> tem uma **cadeia de identidade** (id externo → referência → conjunto determinístico → **hash
> canônico**) e uma **política de atualização** (imutável × mutável). Detalhamento completo em
> `data-contract.md` §9. Resumo:

| Entidade | Identidade (em ordem de precedência) | Reimportação |
|---|---|---|
| Order / OrderItem | `(account, orderId[, variationSku])` | **upsert** do snapshot; preserva histórico |
| WalletTransaction | `externalTransactionId` → referência → **hash canônico** (inclui `balanceAfter`, `adjustmentAmount`, `direction`, `status`) | imutável; ignora duplicata; **nunca** por `orderId+data+valor` |
| AccelerationEvent | `redemptionId+orderId` → `orderId+tipo+data+ref` → **hash canônico** | imutável; **nunca** só por `orderId` |
| AffiliateCommission | `attributionId+orderId+produto/SKU+afiliado+campanha+período` → **hash canônico** | imutável; não colapsa comissões legítimas |
| ReturnRefund (processo) | `(account, returnId)` | snapshot atualizável |
| ReturnRefundEvent | **hash canônico** `(returnId+status+valores+rastreio+observedAt)` | imutável; novo evento a cada mudança |
| OrderCancellation | `(account, orderId)` | upsert |
| FailedDelivery | `(account, orderId, trackingCode)` | upsert |
| ImportBatch | `fileHash` | avisa "arquivo já importado"; reprocesso controlado |

**Campos de rastreamento em todo evento:** `dedupHash`, `firstSeenBatchId`, `lastSeenBatchId`,
`observedAt`. **Reimportar o mesmo arquivo nunca duplica dado financeiro** e **períodos
sobrepostos** (01–10 depois 05–15) inserem só o novo, preservam o anterior e **nunca apagam** um
evento que deixou de aparecer num arquivo posterior (`data-contract.md` §9.4).

---

## 5. Regras iniciais de conciliação (determinísticas)

Ordem de confiança para **vínculo automático** (só determinístico):

1. Mesma loja **+ ID exato do pedido** (chave principal).
2. Identificadores externos exatos (`redemptionId`, `returnId`, `attributionId`).
3. Relação explícita declarada no relatório (ex.: descrição da carteira cita o `orderId`).
4. Demais correspondências determinísticas.

Correspondência **aproximada** (valor/data/descrição/comprador/SKU) → gera **sugestão**,
nunca confirmação automática (salvo regra aprovada e testada).

### Reconstrução por pedido
Para cada `Order`, o motor agrega os eventos ligados por `orderId` e calcula a ficha:
`valor original → valor vendido (Preço acordado) → pago pelo comprador → taxas Shopee →
comissão afiliados → taxa Acelera → entradas carteira → saídas/ajustes → reembolsos →
compensações → custo interno → resultado → valor não explicado`.

Distingue **previsto** (do pedido) × **identificado em relatório** × **confirmado na carteira**
× **pendente** × **divergente**. Reembolso **solicitado ≠ debitado** — só o débito confirmado
na carteira conta como prejuízo.

### Estados
`PENDING_PROCESSING · AUTO_RECONCILED · PARTIALLY_RECONCILED · WAITING_FOR_DATA ·
WAITING_FOR_MARKETPLACE · VALUE_DIVERGENCE · UNMATCHED · MANUALLY_RECONCILED ·
IGNORED_WITH_JUSTIFICATION · REOPENED`.

### 5.1 Classificação temporal — ausência esperada × falta real (obrigatório)

Um evento ausente **não** vira pendência operacional automaticamente no momento da importação.
Antes, o motor classifica a **situação temporal** comparando a data esperada do evento com o
**período coberto** pelos arquivos importados e com uma **janela de tolerância** por tipo de
evento (ex.: prazo normal de liquidação da carteira, prazo de fechamento de devolução).

| Situação temporal | Significado | Vira pendência? |
|---|---|---|
| `NOT_YET_EXPECTED` | dado ainda não deveria ter aparecido (dentro do prazo de liquidação) | **não** |
| `WAITING_COMPLEMENTARY_PERIOD` | período importado não cobre a data esperada (falta importar o arquivo daquele intervalo) | não — sinaliza "importar período X" |
| `WAITING_FOR_MARKETPLACE` | já deveria ter aparecido; aguardando a Shopee dentro da tolerância | informativo |
| `OVERDUE_DIVERGENCE` | passou a janela de tolerância e continua faltando/divergente | **sim** |
| `REAL_PENDENCY` | ausência/divergência confirmada com impacto financeiro | **sim** (prioriza) |

O objetivo é **não encher a fila diária de falsos problemas**: só `OVERDUE_DIVERGENCE` e
`REAL_PENDENCY` entram na fila operacional; os demais ficam como estado do pedido, visíveis mas
fora da fila de trabalho. A cada novo arquivo, o reprocessamento reavalia a situação temporal.

> Pela inspeção, a maioria dos pedidos num primeiro import fica em `NOT_YET_EXPECTED` /
> `WAITING_COMPLEMENTARY_PERIOD` (o evento financeiro ainda não chegou ou está fora do período
> importado). Isso é **correto** e esperado — ver §6 da inspeção. Ele **não** deve ser tratado
> como pendência real até vencer a janela de tolerância.

### Reprocessamento
A cada novo arquivo/sync: reprocessa só as pendências afetadas; resolve automaticamente
apenas vínculos determinísticos; preserva justificativas/decisões manuais; só reabre pendência
resolvida em caso de **conflito real**.

---

## 6. Central de pendências

Tipos: `movimentação sem pedido · pedido sem movimentação · divergência de valor ·
devolução sem débito localizado · débito sem devolução · compensação pendente ·
antecipação com ajuste pendente · afiliado sem pedido · duplicidade · SKU sem categoria ·
categoria sem custo · arquivo/período ausente · evento fora do período · diferença na
declaração semanal`.

Prioridades: **CRITICAL** (débito sem origem, duplicidade financeira, reembolso debitado
incorreto) · **HIGH** (divergência de valor, compensação pendente, devolução sem fechamento) ·
**MEDIUM** (SKU sem categoria, custo ausente, aguardando outro relatório) · **LOW** (dados
complementares).

Ações manuais (todas **auditadas**): vincular · alterar vínculo · dividir movimentação ·
agrupar · classificar sem pedido · aguardar Shopee/novo arquivo · resolver/ignorar com
justificativa · reabrir · observar · atribuir responsável.

Regra operacional: o dia pode terminar com pendências, mas **nenhuma** sem status,
responsável ou justificativa.

> **Entra na fila apenas o que é falta real.** A fila operacional recebe somente itens com
> situação temporal `OVERDUE_DIVERGENCE` ou `REAL_PENDENCY` (§5.1). Itens `NOT_YET_EXPECTED`,
> `WAITING_COMPLEMENTARY_PERIOD` e `WAITING_FOR_MARKETPLACE` ficam visíveis como **estado do
> pedido**, não como pendência de trabalho — isso impede a fila diária de virar uma lista
> enorme de falsos problemas.

---

## 7. Divisão em blocos (com critério de aceite)

| Bloco | Entrega | Aceite |
|---|---|---|
| **0. Inspeção** ✅ | inventário, contrato de dados, modelo, regras, protótipo | *este documento + `index.html`* |
| **1. Base** | monorepo, Postgres/Prisma, auth, orgs/lojas, layout, menu, permissões, auditoria, Docker, seed | sistema abre, tem login e aparência profissional |
| **2. Importação** | upload, leitura CSV/XLS/XLSX, detecção, prévia, validação, rawPayload, normalização, lotes, hash, idempotência | **todos os 8 arquivos reais entram corretamente** |
| **3. Pedidos e eventos** | orders/itens/carteira/acelera/afiliados/devoluções/cancelamentos/falhas/produtos/SKU/categorias/custos | ao abrir um pedido, todos os eventos aparecem relacionados |
| **4. Conciliação** | motor determinístico, estados, ficha financeira, divergências, reprocessamento, linha do tempo | sistema cruza os arquivos reais e mostra conciliado × não |
| **5. Pendências** | fila diária, prioridades, responsáveis, ações manuais, histórico, reabertura | financeiro trata exceções sem planilha paralela |
| **6. Dashboard/Relatórios** | indicadores, filtros, relatórios, valores não explicados, auditoria semanal, devoluções | empresa entende o resultado e onde o dinheiro não foi explicado |
| **7. API** | interface de conectores, tabela de conexões, execução, logs, cursores, adaptador da API interna | conector pronto; implementação real só após documentação da API |

Execução de cada bloco: plano → arquivos afetados → riscos → implementação → lint → typecheck
→ testes → correção → evidências → **aguardar validação**. Sem avançar em silêncio; sem
esconder falhas; sem declarar "funciona" sem teste; arquivos reais usados na validação.

---

## 8. Decisões registradas (respostas do cliente)

As quatro dúvidas foram respondidas e viram requisitos:

**8.1 Custos internos por categoria** — cadastro **no próprio sistema** (não por planilha
nesta versão). Requer: cadastro de categorias internas; custos por categoria; `validFrom`;
histórico de alterações; **edição em massa**; e *hook* preparado para importar planilha de
custos no futuro. O custo aplicado ao pedido fica como **snapshot histórico**
(`OrderItemCostSnapshot`); alterar o custo atual **não** modifica pedidos antigos já calculados.

**8.2 SKU → categoria interna** — vínculo feito por **tela de classificação**. Requer: lista de
SKUs não classificados; seleção individual e **em massa**; busca e filtros; vínculo SKU↔categoria;
alteração posterior com **histórico**; **sugestão por prefixo/padrão** de SKU — mas **sem
classificação automática irreversível** (a regra em massa é apenas *sugerida* e o usuário
**aprova**). Modelado em `SkuClassification(+History)` e `ClassificationRuleSuggestion`.

**8.3 Declaração de renda semanal** — será enviada **depois**. Não bloqueia os primeiros blocos.
O contrato/estrutura ficam **preparados** (`WeeklyIncomeStatement`), mas **sem** regras
específicas até o arquivo ser inspecionado. Quando chegar, passará por **nova inspeção** e o
contrato será atualizado.

**8.4 Multiloja** — o MVP começa com **uma** loja (`lidermolduras`), mas a arquitetura permanece
**multiloja**. **Nenhum** registro (financeiro, pedido, importação, custo, integração,
conciliação) pode existir sem `organizationId` **e** `marketplaceAccountId`. **Não** haverá,
por ora, experiência complexa de administração multiloja — apenas o **isolamento** correto.

Nenhuma dessas decisões bloqueia o Bloco 1.

---

## 9. Segurança e privacidade

- Planilhas reais **não** versionadas (`.gitignore`); fixtures sanitizadas nos testes.
- Credenciais/tokens criptografados; nunca em logs nem no frontend.
- Validação de upload: extensão **e** conteúdo (magic bytes), limite de tamanho, sanitização
  de nome de arquivo, bloqueio de fórmulas perigosas.
- Controle de acesso por papel (ADMIN/FINANCIAL/VIEWER) e isolamento por organização/loja —
  **nunca** vincular dados de lojas diferentes.

---

## 10. Próximo passo

Inspeção e direção **aprovadas** pelo cliente, com os ajustes obrigatórios já incorporados
(deduplicação por relatório + hash canônico, snapshots, classificação temporal, sobreposição de
períodos, precedência de fontes, decisões §8). O **plano exato do Bloco 1** está em
[`docs/bloco-1-plano.md`](bloco-1-plano.md), aguardando validação antes da implementação.

> **Nota sobre o protótipo:** o `index.html` foi aprovado **apenas como direção visual**, não
> como aceite de funcionamento. Os dados demonstrativos **não** serão usados como seed que possa
> ser confundido com dados reais; qualquer dado simulado permanece rotulado como demonstração.
