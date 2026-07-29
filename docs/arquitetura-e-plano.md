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

### Eventos financeiros (um por fonte)
- `WalletTransaction`, `AccelerationEvent`, `AffiliateCommission`, `ReturnRefund`,
  `OrderCancellation`, `FailedDelivery`, `AffiliatePerformanceSnapshot`, `WeeklyIncomeStatement`.
- Cada evento guarda **origem**: `importRowId`, `importBatchId`, `ingestionSource`,
  `externalId`, `rawPayload`, data de importação.

### Conciliação
- `OrderReconciliation(orderId, state, completeness, reconciledAmount, unexplainedAmount, lastAttemptAt)`
- `ReconciliationLink(id, orderId?, eventType, eventId, linkType[AUTO|MANUAL], confidence, ruleId, justification, createdByUserId, timestamps)`
- `Pendency(id, type, priority, status, orderId?, amount, source, assigneeId?, suggestion, ageDays, history Json, lastAutoAttemptAt, timestamps)`
- `AuditLog(id, organizationId, userId, action, entityType, entityId, beforePayload, afterPayload, metadata, createdAt)`

### Usuários
- `User(role ∈ ADMIN|FINANCIAL|VIEWER)` + auth. Credenciais/tokens **criptografados**, nunca em log.

---

## 4. Regras de deduplicação (idempotência)

| Entidade | Chave natural | Ação em reimportação |
|---|---|---|
| Order / OrderItem | `(account, orderId[, variationSku])` | **upsert** (atualiza campos, preserva histórico) |
| WalletTransaction | hash `(occurredAt, type, amount, orderId, description)` | ignora duplicata; nunca duplica dinheiro |
| AccelerationEvent | `(account, redemptionId, orderId)` | upsert |
| AffiliateCommission | `(account, orderId, attributionId)` | upsert |
| ReturnRefund | `(account, returnId)` | upsert |
| OrderCancellation | `(account, orderId)` | upsert |
| FailedDelivery | `(account, orderId, trackingCode)` | upsert |
| ImportBatch | `fileHash` | avisa "arquivo já importado"; permite reprocesso controlado |

**Reimportar o mesmo arquivo nunca duplica dado financeiro.** O `fileHash` bloqueia reenvio
acidental; o hash por linha garante idempotência mesmo em arquivos parcialmente sobrepostos.

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

> Pela inspeção, a maioria dos pedidos num primeiro import fica em `WAITING_FOR_DATA`
> (evento financeiro ainda não chegou). Isso é **correto** e esperado — ver §6 da inspeção.

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

## 8. Dúvidas realmente bloqueadoras

A maioria das perguntas foi respondida pela inspeção. Restam **poucas** que dependem de
decisão de negócio (não dá para inferir dos arquivos):

1. **Custo interno por categoria** — não há arquivo de custos. Como o sistema deve receber os
   custos por categoria interna (upload próprio, cadastro manual na tela, ou planilha à parte)?
   Sem isso, todo pedido gera pendência `categoria sem custo` (comportamento já previsto).
2. **Mapeamento SKU → categoria interna** — os SKUs reais (ex.: `KIT-6-PERSONALIZADO-50X50…`,
   `3000-CX-80x120-MF-SV`) precisam ser agrupados em categorias internas. Existe uma regra
   (prefixo do SKU? tabela de‑para?) ou será cadastro manual?
3. **Declaração de renda semanal** — o relatório citado no prompt (fonte de auditoria de
   totais) **não** foi enviado. Confirmar se virá e em qual formato, ou se a auditoria semanal
   deve, por ora, usar os totais do "Resumo" da carteira.
4. **Multiloja** — os arquivos citam `lidermolduras`. Haverá mais de uma loja Shopee no MVP,
   ou começamos com uma conta e mantemos a estrutura multiloja preparada?

Nenhuma dessas dúvidas bloqueia o **upload manual** nem os blocos 1–2.

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

Entregues: **inspeção + contrato de dados + modelo + regras + plano + `index.html` navegável**.
Aguardando sua **aprovação do visual e do diagnóstico** antes de iniciar o **Bloco 1**.
