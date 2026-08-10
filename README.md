# Conciliação Financeira Shopee

Sistema de **conciliação financeira** da Shopee: recebe os relatórios (planilhas hoje, API no
futuro), preserva os dados brutos, normaliza, deduplica, cruza por pedido e reconstrói a
história financeira de cada pedido — mostrando o que foi recebido, cobrado, antecipado,
reembolsado, compensado e o que **ainda não foi explicado**.

> Foco exclusivo: **conciliação**. Não é ERP, não é gestor de devoluções. Devoluções,
> afiliados, Shopee Acelera, cancelamentos e falhas de entrega são **fontes** que explicam
> o resultado financeiro dos pedidos.

## Estado atual — Bloco 2 (Importação) implementado

Além da base do Bloco 1, a **Central de Importações** já recebe os oito relatórios reais
(CSV/XLS/XLSX), detecta o formato **pelo conteúdo** (não pela extensão), localiza o
cabeçalho mesmo fora da linha 1, mostra prévia e alertas, preserva todas as linhas
originais, normaliza, **deduplica por relatório (hash canônico)** e é **idempotente**
(reimportar não duplica). Ver **[docs/bloco-2-plano.md](docs/bloco-2-plano.md)**,
**[docs/bloco-2-matriz.md](docs/bloco-2-matriz.md)** (matriz dos 8 arquivos) e
**[docs/bloco-2-evidencias.md](docs/bloco-2-evidencias.md)** (testes + capturas + roteiro).

> **Homologação com arquivos reais (Bloco 2.1) — pendente.** O desenvolvimento está
> validado sobre fixtures sanitizadas; a conclusão definitiva depende de importar as
> **planilhas reais da Shopee** na sua máquina. Guia + harness de pré-check:
> **[docs/bloco-2-homologacao.md](docs/bloco-2-homologacao.md)**. Duas formas de
> pré-check dos seus arquivos, ambas **100% locais**: abrir **`docs/homologacao.html`**
> no navegador (arrastar os arquivos — roda o motor real, offline, nada é enviado)
> ou `pnpm --filter @financeiro/api homologar -- /pasta/dos/arquivos` no terminal.

Bloco 1 (base): autenticação, isolamento multiloja, usuários/permissões, auditoria, Docker,
migrações, seed e telas reais — **[docs/bloco-1-plano.md](docs/bloco-1-plano.md)** e
**[docs/bloco-1-evidencias.md](docs/bloco-1-evidencias.md)**.

## Bloco 3 — Produtos, Variações/SKUs, Famílias e Custos

Primeira fundação do **cadastro** que conectará os próximos módulos. A tela **Produtos
Shopee** recebe a planilha de produtos da Shopee (`.xlsx`), **localiza o cabeçalho fora
da linha 1**, ignora as linhas técnicas/de instrução, **agrupa por anúncio** e
materializa **anúncios + variações/SKUs** com preço cheio e estoque próprios.
Reimportar é **idempotente**: sincroniza preço/estoque **sem duplicar** e **sem
apagar** os dados internos (família e **preço de fechamento**). As **Famílias** são a
unidade interna de **custo** (com **histórico**), e a classificação de SKUs em família
pode ser feita **em massa**. Regra central: **SKU → variação → família → custo vigente**.
Ver **[docs/bloco-3-plano.md](docs/bloco-3-plano.md)**.

### Rodar localmente

```bash
# 1. Banco (Postgres 16 + Redis 7)
docker compose up -d

# 2. Dependências
corepack enable && pnpm install

# 3. Variáveis de ambiente
cp .env.example .env

# 4. Banco: migração + seed de demonstração
pnpm db:generate && pnpm db:migrate && pnpm db:seed

# 5. (opcional) gerar as fixtures sanitizadas dos 8 relatórios para testar
node_modules/.bin/tsx apps/api/test/fixtures/generate.ts

# 6. Subir API (3001) e Web (3000)
pnpm dev
```

Acesse http://localhost:3000 e entre com um dos usuários de demonstração
(`admin@demo.local` · `financeiro@demo.local` · `viewer@demo.local`, senha `Demo@12345`).
Depois, menu **Importações → Nova importação** para enviar as planilhas.

### Qualidade
```bash
pnpm lint          # ESLint em todos os pacotes
pnpm typecheck     # tsc --noEmit em todos os pacotes
pnpm test          # unit + e2e (API contra Postgres) — 62 testes
pnpm --filter @financeiro/web test:e2e   # Playwright: smoke + importação (requer API+Web no ar)
```

## Documentos de planejamento (Bloco 0)

| Documento | Conteúdo |
|---|---|
| [`docs/00-inspecao-dados.md`](docs/00-inspecao-dados.md) | Inventário dos 8 relatórios, formatos, IDs, mapa de campos, riscos |
| [`docs/data-contract.md`](docs/data-contract.md) | Contrato de dados: cabeçalhos, aliases, tipos, transformações, dedup |
| [`docs/arquitetura-e-plano.md`](docs/arquitetura-e-plano.md) | Stack, modelo de dados, deduplicação, classificação temporal, decisões, blocos |
| [`docs/bloco-1-plano.md`](docs/bloco-1-plano.md) | Plano do Bloco 1 (base do sistema) |
| [`docs/bloco-2-plano.md`](docs/bloco-2-plano.md) | **Plano do Bloco 2** (importação) — tabelas, endpoints, telas, detecção, dedup |
| [`docs/bloco-2-matriz.md`](docs/bloco-2-matriz.md) | **Matriz dos 8 relatórios** com números reais |
| [`index.html`](index.html) | Protótipo visual navegável — só direção visual |

### Como ver o protótipo
Abra `index.html` diretamente no navegador (duplo clique). Não precisa de backend nem de
internet. Clique em **Entrar** e navegue pelas telas: Dashboard, Importações, Conciliação,
Pendências, Pedidos, detalhe financeiro do pedido, Movimentações, Produtos e custos,
Relatórios e Integrações. Todos os números são **dados demonstrativos** de exemplo.

## Relatórios suportados (inspecionados)
Pedidos · Carteira Shopee · Shopee Acelera · Afiliados (comissão e performance) ·
Devoluções/Reembolsos · Cancelamentos · Falha na entrega. (Declaração de renda semanal
prevista, ainda não fornecida.)

## Stack planejada
Next.js + NestJS + TypeScript · PostgreSQL + Prisma · Redis/BullMQ (quando necessário) ·
valores sempre em `Decimal` · isolamento por organização/loja.

## Segurança
Planilhas reais **não** são versionadas (`.gitignore`). Fixtures de teste são sanitizadas.
Credenciais/tokens criptografados e nunca em logs.

## Próximo passo
Blocos 2 (Importação) e 3 (Produtos e Famílias) concluídos. Próximo: **Pedidos e
eventos** — materializar as tabelas de eventos financeiros a partir das linhas já
importadas, relacioná-las por pedido e cruzar com produto/variação/família/custo para
reconstruir o resultado real de cada pedido.
