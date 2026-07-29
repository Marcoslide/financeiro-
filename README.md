# Conciliação Financeira Shopee

Sistema de **conciliação financeira** da Shopee: recebe os relatórios (planilhas hoje, API no
futuro), preserva os dados brutos, normaliza, deduplica, cruza por pedido e reconstrói a
história financeira de cada pedido — mostrando o que foi recebido, cobrado, antecipado,
reembolsado, compensado e o que **ainda não foi explicado**.

> Foco exclusivo: **conciliação**. Não é ERP, não é gestor de devoluções. Devoluções,
> afiliados, Shopee Acelera, cancelamentos e falhas de entrega são **fontes** que explicam
> o resultado financeiro dos pedidos.

## Estado atual — Bloco 0 (Inspeção) concluído

Esta entrega é o **diagnóstico dos dados + arquitetura + protótipo visual**, para aprovação
antes do desenvolvimento (Bloco 1). Nenhum código funcional do sistema foi escrito ainda.

| Documento | Conteúdo |
|---|---|
| [`docs/00-inspecao-dados.md`](docs/00-inspecao-dados.md) | Inventário dos 8 relatórios, formatos, IDs, mapa de campos, riscos |
| [`docs/data-contract.md`](docs/data-contract.md) | Contrato de dados: cabeçalhos, aliases, tipos, transformações, dedup |
| [`docs/arquitetura-e-plano.md`](docs/arquitetura-e-plano.md) | Stack, modelo de dados, deduplicação, classificação temporal, decisões, blocos |
| [`docs/bloco-1-plano.md`](docs/bloco-1-plano.md) | **Plano exato do Bloco 1** (base do sistema) — para validação |
| [`index.html`](index.html) | **Protótipo visual navegável** (abra no navegador) — só direção visual |

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
Aguardando aprovação do **diagnóstico** e do **visual (`index.html`)** para iniciar o
**Bloco 1 — Base do sistema**.
