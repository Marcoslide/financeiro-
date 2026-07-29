# Bloco 1 — Evidências de Conclusão

Base do sistema implementada e validada. Abaixo, o que foi entregue, as evidências de
qualidade e os desvios do plano original.

## Critérios de aceite (§9 do plano)

| Critério | Status |
|---|---|
| Banco sobe; migração + seed populam a base demo | ✅ Postgres 16, migração `init_bloco1`, seed OK |
| Login funciona com os 3 usuários seed | ✅ verificado ao vivo (curl + UI) |
| Papéis aplicados (ADMIN/FINANCIAL/VIEWER) | ✅ guards + teste (VIEWER→403) |
| CRUD de usuários + visualização de loja, com auditoria before/after | ✅ criado usuário pela UI; auditoria gravada |
| Isolamento por organização/loja com guard e teste | ✅ `TenantGuard` + testes |
| Aparência profissional consistente com o protótipo | ✅ ver capturas |
| `lint`, `typecheck`, `test` verdes | ✅ ver abaixo |
| README com execução local | ✅ |

## Evidências de qualidade

```
$ pnpm lint
  Tasks:    4 successful, 4 total   (shared, database, api, web — sem erros)

$ pnpm typecheck
  Tasks:    5 successful, 5 total

$ pnpm test
  @financeiro/shared:test  ✓ 4 tests
  @financeiro/api:test      ✓ src/common/crypto.spec.ts (3)
                            ✓ src/common/guards.spec.ts (5)
                            ✓ test/app.e2e-spec.ts (7)  ← contra Postgres real
  Tests: 19 passed (19)

$ pnpm --filter @financeiro/web test:e2e
  ✓ e2e/smoke.spec.ts › login e navegação básica
  1 passed
```

Cobertura de teste do Bloco 1:
- **unit**: AES-256-GCM (cripto de credenciais); `RolesGuard` (permite/bloqueia por papel);
  `TenantGuard` (injeta tenant / bloqueia sem organização); enums compartilhados.
- **e2e (API contra Postgres)**: health público; login (200 com tokens); senha errada (401);
  rota protegida sem token (401); VIEWER criando usuário (403); ADMIN cria usuário e a ação é
  auditada (verifica `USER_CREATE` no `AuditLog`); refresh rotaciona o token.
- **smoke E2E (UI)**: login → dashboard → usuários.

## Telas reais (capturas)
Login, Dashboard (autenticado), Usuários (CRUD com criação real), Lojas e Auditoria — todas
servidas pelo Next.js consumindo a API NestJS. As capturas foram anexadas na conversa de entrega.

## Desvios do plano (transparência)

1. **Ambiente sem daemon Docker** — o `docker-compose.yml` está entregue e correto, mas neste
   ambiente de execução o daemon do Docker não está acessível. Para gerar evidências reais,
   subi um **cluster PostgreSQL 16 local** (mesmo motor). Em uma máquina com Docker,
   `docker compose up -d` faz o mesmo papel.
2. **Runner de testes** — o plano citava "Jest+Supertest" para e2e. Para manter **um único
   runner** e evitar conflito de configuração de decorators, usei **Vitest+Supertest** (com
   `unplugin-swc`) tanto para unit quanto para e2e. Cobertura idêntica à prevista.
3. **Versões do ambiente** — Node 22 e pnpm 10 (o ambiente já os traz), no lugar de Node 20 /
   pnpm 9 do plano. Sem impacto nas dependências fixadas (NestJS 10, Next 14, Prisma 5.22).

## Limitações conhecidas (esperadas neste bloco)
- Sem importadores nem motor de conciliação (Blocos 2–4). As telas de Importações,
  Conciliação, Pendências, Pedidos, Movimentações, Produtos e Relatórios aparecem no menu como
  **"em breve"** (placeholder honesto, sem dado fictício).
- Dashboard com indicadores **zerados** até a primeira importação.
- `MarketplaceConnection` guarda apenas a estrutura (credenciais criptografadas); a execução
  real de API vem no Bloco 7.
- Redis/BullMQ provisionados no compose, mas **sem uso** até o Bloco 2.
- Sem deploy em produção; sem credenciais reais (seed é de demonstração).
