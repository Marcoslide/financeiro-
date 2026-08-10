# Bloco 3 — Produtos, Variações/SKUs, Famílias e Custos

Primeira fundação do cadastro que conectará os próximos módulos (pedidos, financeiro,
Ads, afiliados, devoluções, rentabilidade). Entrega: **Produtos Shopee + Variações/SKUs
+ Famílias + Custos + Importador da planilha de produtos da Shopee**.

## Conceitos centrais

- **Anúncio Shopee (`Product`)** é a entidade principal, identificada por
  `shopeeProductId` (**ID do Produto**). O mesmo ID se repete em várias linhas da
  planilha — cada linha é uma **variação**.
- **Variação/SKU (`ProductVariation`)** é a entidade filha, identificada dentro do
  anúncio por `variationKey` (derivada do **Variante Identificador**; se vazio, cai
  para o SKU e, por fim, uma sentinela — sempre estável entre reimportações).
- **Família (`ProductFamily`)** é a **unidade interna de CUSTO**. Vários SKUs apontam
  para uma família; o custo mora na família e tem **histórico**
  (`ProductFamilyCostHistory`) — pedidos antigos preservam o custo vigente à época.
- Regra central: **SKU → variação → família → custo vigente** (base para lucro por
  pedido nos próximos blocos). Resolvida por `ProductsService.resolveVariationCost`.

## Importador (passo único, idempotente)

`POST /api/products/import` (multipart, `.xlsx`). O parser
(`products/parsing/product-sheet.ts`) reaproveita as primitivas do Bloco 2 e:

1. localiza o **cabeçalho amigável fora da linha 1** (no relatório real ele aparece
   por volta da linha 3), varrendo as abas em busca de `ID do Produto` + `Nome do
   Produto`;
2. **ignora as linhas técnicas/de instrução** entre o cabeçalho e os dados (a 1ª
   linha de dados é a primeira cujo `ID do Produto` é um id numérico);
3. **agrupa por anúncio** e materializa variações com SKU, preço cheio e estoque
   próprios.

Sincronização (upsert) — ver `ProductsService.syncCatalog`:

- anúncio/variação **novos** → criados; **existentes** → não duplicados;
- campos **importados da Shopee** (nome, preço cheio, estoque, GTIN, motivo de falha)
  são **atualizados** quando mudam;
- campos **internos** (família, **preço de fechamento**, notas) **nunca** são
  sobrescritos por reimportação;
- resultado detalhado (anúncios/variações identificados, novos, atualizados, sem
  alteração, ignorados, erros) + histórico em `ProductImportBatch` (prompt §17/§18).

`Preço` da planilha = **preço cheio Shopee** (`shopeeFullPrice`). O **preço de
fechamento** (`closingPrice`) é campo nosso, editável, e nunca é inferido do preço
cheio: quando ausente, a interface mostra “não informado”.

## Telas (Web)

- **Produtos Shopee** (`/produtos`): importador no topo, indicadores (anúncios, SKUs,
  SKUs sem família, SKUs sem preço de fechamento), filtros (busca, com/sem família,
  com/sem preço de fechamento), listagem **por anúncio com variações expansíveis**,
  **seleção em massa por checkbox → Classificar família**, edição do preço de
  fechamento e histórico de importações.
- **Famílias** (`/produtos/familias`): CRUD com custo, status e **histórico de custo**.

## Isolamento e permissões

Toda tabela carrega `organizationId` (+ `marketplaceAccountId`). Leitura liberada a
todos os papéis; importar/classificar/editar/criar família exige **ADMIN/FINANCIAL**.

## Testes (contra o Postgres real)

- `apps/api/src/products/parsing/product-sheet.spec.ts` — parser (cabeçalho fora da
  linha 1, linhas ignoradas, variação única por SKU, linha com erro).
- `apps/api/test/products.e2e-spec.ts` — importação, agrupamento por anúncio,
  **reimportação sem duplicar**, **sincronização de estoque/preço preservando família
  e preço de fechamento**, criação de família com custo, classificação em massa,
  histórico de custo e permissões. Fixture sintético em
  `apps/api/test/fixtures/product-workbook.ts` (nenhum dado real é versionado).
