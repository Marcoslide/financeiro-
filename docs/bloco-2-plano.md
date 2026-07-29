# Bloco 2 — Importação (plano executado)

Entrada **confiável, auditável e sem duplicação** dos oito relatórios da Shopee.
Escopo estrito do bloco: **só a entrada de dados**. Não há motor de conciliação,
lucro, fila de pendências, dashboard financeiro nem integração de API aqui.

## 1. Fluxo
Duas fases: **Analisar** (upload → detecção → prévia → alertas) e **Confirmar**
(processamento → normalização → dedup → gravação). Processamento **síncrono**
(volumes ~300 linhas; BullMQ/Redis adiado). Toda linha original é preservada.

## 2. Tabelas e migrações
Migração `20260729144425_bloco2_importacoes`:
- Enums `ReportType`, `FileFormat`, `ImportBatchStatus`, `ImportRowStatus`.
- **`import_batches`** — metadados completos do resultado (arquivo, formato real,
  aba, `headerRowIndex`, `dataStartRowIndex`, colunas, linhas físicas/dados,
  `fileHash`, `storageKey`, período, contadores importadas/atualizadas/duplicadas/
  alerta/erro, `processingMs`, status, `analysis` JSON, `reprocessedFromBatchId`).
- **`import_rows`** — `sheetName`, número físico e lógico, `rawPayload` (imutável),
  `detectedIdentifiers`, `rawHash`, `canonicalHash`, `canonicalHashVersion`,
  `processingStatus`, `warnings`, `errors`, `externalOrderId`, `externalReference`.
- **`import_dedup_keys`** — livro de identidade `(loja, relatório, hash canônico)`
  único + índice por `naturalKey`, com `firstSeenBatchId`/`lastSeenBatchId`.
  É o que garante dedup entre lotes/períodos sem materializar ainda as tabelas
  financeiras (Bloco 3).

## 3. Módulos e endpoints (`apps/api/src/imports`)
- `POST /imports/analyze` — upload multipart + análise → lote `AWAITING_CONFIRMATION`.
- `POST /imports/:id/confirm` — processa e fecha os contadores.
- `POST /imports/:id/reprocess` — reprocesso controlado e idempotente.
- `GET /imports` · `GET /imports/:id` · `GET /imports/:id/rows?status=&issue=` — leitura.
- `DELETE /imports/:id` — descarta rascunho.
- Escrita: `@Roles(ADMIN, FINANCIAL)`; leitura inclusive VIEWER. Tudo isolado por
  organização + posse da loja. Toda ação **auditada** (`IMPORT_ANALYZE/CONFIRM/REPROCESS/DISCARD`).

## 4. Telas (`apps/web/src/app/(app)/importacoes`)
- **Central** — lista de lotes com contadores e status; botão "Nova importação".
- **Wizard** (3 etapas) — loja + arrastar arquivo → prévia (tipo sugerido, confiança,
  formato real, cabeçalho, colunas, período, alertas, primeiras linhas, correção
  manual do tipo) → resultado.
- **Detalhe do lote** — todos os números reais + tabela de linhas filtrável
  (importadas/duplicadas/atualizadas/alerta/erro) + reprocessar.

## 5. Armazenamento
Interface `FileStorage` + `LocalDiskStorage` (preparada p/ S3). Bytes originais
gravados intactos em `STORAGE_DIR/{org}/{loja}/{fileHash}.{ext}`. `rawPayload`
imutável após a importação. `STORAGE_DIR` não é versionado.

## 6. Detecção (por conteúdo, nunca só extensão)
Magic bytes (`PK`=XLSX, `\xD0\xCF`=XLS, senão CSV com sniff de delimitador) →
varre até 40 linhas de cada aba procurando a **assinatura de cabeçalho** de cada
relatório → escolhe `(tipo, aba, linha)` com **score de confiança**; abaixo de 0.5
→ `UNKNOWN` + seleção manual. Resolve: Carteira linha 18, Acelera linha 6,
`.xls`→XLSX, colunas duplicadas (por posição), Comissão × Performance distintos,
Falha na entrega ambígua (confiança 0.7 + confirmação).

## 7. Deduplicação por relatório
Cadeia de identidade (`data-contract.md §9`): id externo → chave natural →
**hash canônico** (fallback). Campos do hash por relatório conforme documentado
(ex.: Carteira inclui `balanceAfter`; Acelera inclui `redemptionId+orderId+status+valores`).
- hash igual → **duplicada**;
- mesma chave natural com campo mutável mudado (ex.: status de devolução) → **atualizada**;
- `="123"` limpo sem perder zeros; IDs sempre string; nunca dedup por `(pedido,data,valor)`.
- Dedup de arquivo por `fileHash` (mesmo conteúdo, nomes diferentes → reconhecido).

## 8. Arquivos criados/alterados
- `packages/database/prisma/schema.prisma` + migração; `packages/shared/src/index.ts`.
- `apps/api/src/imports/**` (module, controller, service, dto, storage, `parsing/**`:
  value-parsers, format, workbook, row-accessor, report-specs, detect, hashing,
  analyze, index); `app.module.ts`; `config/env.ts`; `package.json` (xlsx, @types/multer).
- `apps/web/src/app/(app)/importacoes/**`, `components/ImportWizard.tsx`,
  `components/Shell.tsx`, `lib/api.ts`.
- Testes: `parsing/parsing.spec.ts`, `test/fixtures.e2e-spec.ts`, `test/imports.e2e-spec.ts`,
  fixtures + gerador em `test/fixtures/**`; `e2e/imports.spec.ts` (web).
- Docs: este arquivo, `bloco-2-matriz.md`, `bloco-2-evidencias.md`.

## 9. Testes
Unit (parsers, detecção, hash), integração contra Postgres (8 arquivos, reimportação,
nome diferente, períodos sobrepostos, erro isolado, isolamento, permissão, reprocesso)
e E2E de UI (Playwright). Lint + typecheck limpos. **62 testes verdes.**

## 10. Riscos e limitações conhecidas
- **Arquivos reais não versionados** (dados pessoais): a matriz roda sobre fixtures
  sanitizadas que reproduzem a estrutura/volume; o mesmo pipeline lê os originais na tela.
- Fixtures de Cancelamentos/Falha/Comissão usam subconjunto de colunas (o importador
  preserva todas as que existirem no arquivo real).
- `xlsx` (SheetJS 0.18.5, único no npm) tem CVEs de prototype-pollution → mitigado com
  leitura apenas, validação por magic bytes + limite de tamanho; uso dev/interno.
- Processamento síncrono (ok p/ este volume); BullMQ/Redis adiado.
- Reprocesso remove as contribuições do próprio lote e re-executa; lotes posteriores
  que dependiam dele podem precisar de novo reprocesso (aceitável no escopo do bloco).
- Declaração semanal (`WEEKLY_INCOME_STATEMENT`) reservada, sem regras (aguardando arquivo).
