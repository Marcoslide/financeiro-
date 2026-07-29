# Bloco 2 — Matriz dos oito relatórios (importação real)

> Números **reais**, apurados pelo pipeline ao importar as fixtures sanitizadas
> (que reproduzem a estrutura e o volume dos relatórios reais — ver
> `docs/00-inspecao-dados.md`). Gerados pelo teste de integração
> `apps/api/test/imports.e2e-spec.ts` (matriz em `apps/api/test-results/bloco2-matrix.json`).
> Os arquivos originais da Shopee **não** são versionados (dados pessoais); ao
> importá-los na tela real, o mesmo pipeline produz a mesma leitura.

## Matriz

| Relatório | Arquivo | Formato real | Ext. declarada | Cab. (linha) | Colunas | Linhas físicas | Linhas de dados | Válidas | Importadas | Duplicadas | Atualizadas | Alertas | Erros | Confiança | Reimportação (imp / dup) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Pedidos** | `Order.toship…xlsx` | XLSX | .xlsx | 1 | 64 | 220 | 219 | 219 | 219 | 0 | 0 | 0 | 0 | 100% | **0 / 219** |
| **Cancelamentos** | `Order.cancelled…xlsx` | XLSX | .xlsx | 1 | 19¹ | 347 | 346 | 346 | 346 | 0 | 0 | 0 | 0 | 100% | **0 / 346** |
| **Falha na entrega** | `Order.failed_delivery…xlsx` | XLSX | .xlsx | 1 | 14¹ | 9 | 8 | 8 | 8 | 0 | 0 | 0 | 0 | 70%² | **0 / 8** |
| **Devoluções/Reembolsos** | `Order.return_refund…xls` | **XLSX** | **.xls** | 1 | 46 | 151 | 150 | 150 | 149 | 0 | **1**³ | 0 | 0 | 100% | **0 / 150** |
| **Carteira Shopee** | `my_balance_transaction_report…xlsx` | XLSX | .xlsx | **18** | 9 | 250 | 232 | 232 | 232 | 0 | 0 | 0 | 0 | 100% | **0 / 232** |
| **Shopee Acelera** | `2193…_1.csv` | CSV | .csv | **6** | 15 | 301 | 295 | 295 | 295 | 0 | 0 | 0 | 0 | 100% | **0 / 295** |
| **Afiliados — Comissão** | `SellerOnlinePaymentValidationReport…csv` | CSV | .csv | 1 | 16¹ | 44 | 43 | 43 | 43 | 0 | 0 | 0 | 0 | 100% | **0 / 43** |
| **Afiliados — Performance** | `AMSAffiliatePerformance…csv` | CSV | .csv | 1 | 11 | 8 | 7 | 7 | 7 | 0 | 0 | 0 | 0 | 100% | **0 / 7** |

**Notas**
1. As fixtures de **Cancelamentos, Falha na entrega e Comissão** reproduzem as colunas
   estruturalmente relevantes e o volume de linhas, mas com um subconjunto de colunas
   (19/14/16 em vez de 60/59/41). Isso **não** afeta a detecção nem a preservação: o
   importador guarda **todas** as colunas que existirem no arquivo. Pedidos (64),
   Devoluções (46), Carteira (9), Acelera (15) e Performance (11) reproduzem a largura real.
2. **Falha na entrega** compartilha o layout de Pedidos/Cancelamentos; a detecção é
   deliberadamente de **baixa confiança (70%)** e sugere seleção/confirmação manual do tipo
   (o layout sem `Cancelar Motivo` e sem `Taxa de comissão líquida` é ambíguo).
3. A 150ª linha de Devoluções repete a **mesma devolução** da 1ª com **status diferente**
   → classificada como **Atualização** (novo evento lógico), não duplicata — exatamente o
   comportamento exigido (nunca sobrescrever silenciosamente; `data-contract.md` §9.2).

## Validações obrigatórias (todas verdes)

| Caso obrigatório | Evidência (teste) | Resultado |
|---|---|---|
| Importar o mesmo arquivo duas vezes | `imports.e2e-spec.ts` (loop dos 8) | 2ª vez: **0 importadas**, tudo duplicado |
| Arquivo igual com **nome diferente** | "mesmo conteúdo com nome diferente…" | reconhecido por `fileHash`: **0 importadas** |
| **Períodos sobrepostos** (01–15 depois 10–20) | "períodos sobrepostos…" | interseção **40 duplicadas**, **25 novas** importadas |
| Duas movimentações legítimas do **mesmo pedido/dia/valor** | "carteira: duas movimentações legítimas…" | **ambas importadas** (hash canônico difere pelo saldo/direção) |
| **Erro em uma linha** sem invalidar o lote | "erro em uma linha não invalida o lote" | 1 erro isolado, **5 importadas**, status `COMPLETED_WITH_ERRORS` |
| **Isolamento por loja/organização** | "isolamento por organização…" | outra org recebe **404** e lista **vazia** |
| **Bloqueio de usuário sem permissão** | "VIEWER não pode importar (403)" | VIEWER recebe **403** |
| `.xls` com conteúdo XLSX | "devoluções: extensão .xls…" | formato real **XLSX**, `extensionMismatch = true` |
| Cabeçalho fora da linha 1 | Carteira (linha 18) e Acelera (linha 6) | detectados sem hardcode |
| `="219…"` sem perder dígitos; `R$99.54`; `R$331,08`; `-44.31`; `331.08` | `parsing.spec.ts` | todos corretos |
| Reprocessar um lote (controlado) | "reprocessar um lote é idempotente" | mesmos números, **sem duplicar** |

## Como reproduzir

```bash
# Postgres no ar + .env configurado
pnpm --filter @financeiro/database migrate
# (re)gera as fixtures sanitizadas
node_modules/.bin/tsx apps/api/test/fixtures/generate.ts
# roda unit + integração (gera a matriz em apps/api/test-results/bloco2-matrix.json)
pnpm --filter @financeiro/api test
```
