# Bloco 2 — Evidências

## Testes (todos verdes)

Rodado contra Postgres real (`pnpm --filter @financeiro/api test`):

```
✓ src/imports/parsing/parsing.spec.ts (24)   parsers, formato, detecção, hash canônico
✓ test/fixtures.e2e-spec.ts        (13)   parseFile nas 8 fixtures (detecção/cabeçalho/preservação)
✓ test/imports.e2e-spec.ts         (10)   pipeline HTTP: 8 arquivos, dedup, sobreposição, isolamento, permissão
✓ src/common/guards.spec.ts        (5)    (Bloco 1)
✓ src/common/crypto.spec.ts        (3)    (Bloco 1)
✓ test/app.e2e-spec.ts             (7)    (Bloco 1)
Test Files  6 passed | Tests  62 passed
```

Web E2E (Playwright, `apps/web/e2e/imports.spec.ts`): **2 passed** — importa a
Carteira (cabeçalho linha 18) e mostra o resultado; VIEWER não vê "Nova importação".

Qualidade: **lint** limpo (`pnpm lint`), **typecheck** limpo (`pnpm typecheck`).

## Matriz dos oito arquivos
Ver [`bloco-2-matriz.md`](bloco-2-matriz.md). Reimportação de cada arquivo: **0 importadas**.

## Reimportação sem duplicidade
No teste dos 8 arquivos, cada arquivo é importado e **reimportado**; na 2ª vez
`importedRows = 0` e `duplicatedRows = validRows`. Também coberto: mesmo conteúdo
com **nome diferente** (reconhecido por `fileHash`, 0 importadas).

## Períodos sobrepostos
`wallet_periodA.xlsx` e `wallet_periodB.xlsx` compartilham 40 linhas idênticas.
Ao importar B depois de A: **40 duplicadas** (interseção) e **25 novas** importadas —
nenhum evento anterior é apagado.

## Capturas de tela (telas reais)
Em [`evidencias-bloco2/`](evidencias-bloco2/):

| Arquivo | O que mostra |
|---|---|
| `01-central-importacoes.png` | Lista de lotes com contadores e status |
| `02-previa-carteira-linha18.png` | Prévia: Carteira detectada 100%, **cabeçalho linha 18**, período, alertas, primeiras linhas |
| `03-resultado.png` | Resumo do processamento (números reais) |
| `04-detalhe-lote.png` | Detalhe do lote: **todos** os campos exigidos + tabela de linhas com hash canônico |
| `05-previa-acelera-linha6.png` | Acelera: **cabeçalho linha 6**, CSV, id do resgate limpo |
| `06-reimport-dedup.png` | Reimportação: **0 importadas**, tudo duplicado |
| `07-linha-com-erro.png` | Filtro "Com erro": linha inválida isolada, payload preservado |

## Como acessar e testar (local)

Pré-requisitos: Node ≥ 20, pnpm, Postgres (via `docker compose up -d` ou instância local).

```bash
cp .env.example .env                      # ajuste DATABASE_URL se necessário
pnpm install
pnpm --filter @financeiro/shared build
pnpm --filter @financeiro/database generate
pnpm --filter @financeiro/database migrate # aplica Bloco 1 + Bloco 2
pnpm --filter @financeiro/database seed     # cria loja lidermolduras + usuários demo
node_modules/.bin/tsx apps/api/test/fixtures/generate.ts   # gera as 8 fixtures
pnpm dev                                    # sobe API (3001) e Web (3000)
```

Acesse **http://localhost:3000** → login → menu **Importações**.

### Usuários de demonstração (senha `Demo@12345`)
| Papel | E-mail | Pode importar? |
|---|---|---|
| Administrador | `admin@demo.local` | sim |
| Financeiro | `financeiro@demo.local` | sim |
| Consulta | `viewer@demo.local` | não (somente acompanha) |

### Roteiro na interface
1. Importações → **Nova importação** → loja `lidermolduras`.
2. Arraste um arquivo (use os seus reais da Shopee ou as fixtures em
   `apps/api/test/fixtures/files/`).
3. Veja o **relatório sugerido + confiança**, o **cabeçalho detectado**, a **prévia**
   e os **alertas**; corrija o tipo se necessário.
4. **Confirmar** → acompanhe o **resumo** → **Abrir lote** para ver todos os números
   e as linhas (filtre por erro/alerta/duplicada).
5. Importe o **mesmo arquivo** de novo → confirme **0 importadas** (sem duplicação).

> Segurança/privacidade: credenciais reais **não** são usadas; nenhum deploy em
> produção; arquivos originais da Shopee **não** são versionados. As fixtures são
> sanitizadas (dados de demonstração).
