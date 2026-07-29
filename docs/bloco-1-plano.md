# Bloco 1 — Base do Sistema (plano exato para validação)

Objetivo: entregar uma **base confiável** — o sistema abre, tem login, isolamento multiloja,
usuários/permissões, auditoria, Docker, migrações e seed controlado, com aparência profissional.

> **Fora do escopo do Bloco 1:** importadores de planilha e motor de conciliação (Blocos 2–4).
> Aqui não se lê nenhum relatório da Shopee ainda. Primeiro a base.

---

## 1. Estrutura de diretórios (monorepo)

```
financeiro-/
├─ apps/
│  ├─ api/                      # NestJS (backend)
│  │  ├─ src/
│  │  │  ├─ main.ts
│  │  │  ├─ app.module.ts
│  │  │  ├─ common/             # filtros de erro, guards, decorators, interceptors
│  │  │  ├─ config/             # env schema (zod), config service
│  │  │  ├─ prisma/             # PrismaService, module
│  │  │  ├─ auth/               # login, JWT, refresh, hashing
│  │  │  ├─ users/             # CRUD de usuários, papéis
│  │  │  ├─ organizations/      # organização
│  │  │  ├─ marketplace-accounts/  # lojas (contas de marketplace)
│  │  │  └─ audit/              # AuditLog service + interceptor
│  │  ├─ test/                  # e2e (supertest)
│  │  └─ tsconfig.json
│  └─ web/                      # Next.js (frontend, App Router)
│     ├─ src/
│     │  ├─ app/
│     │  │  ├─ (auth)/login/
│     │  │  └─ (app)/           # layout com sidebar/topbar
│     │  │     ├─ dashboard/
│     │  │     ├─ usuarios/
│     │  │     ├─ lojas/
│     │  │     └─ configuracoes/
│     │  ├─ components/         # ui/ (Button, Table, Card, Badge, Modal, Drawer, Toast…)
│     │  ├─ lib/                # api client, auth, format (R$, datas BR)
│     │  └─ styles/
│     └─ tsconfig.json
├─ packages/
│  ├─ database/                 # schema.prisma, migrations, seed, generated client
│  │  ├─ prisma/schema.prisma
│  │  ├─ prisma/migrations/
│  │  └─ prisma/seed.ts
│  └─ shared/                   # tipos e enums compartilhados (papéis, estados)
├─ docker-compose.yml           # postgres + redis (redis já sobe, usado a partir do Bloco 2)
├─ .env.example
├─ package.json                 # workspaces (pnpm)
├─ pnpm-workspace.yaml
├─ turbo.json                   # orquestração de scripts (build/lint/test)
└─ docs/
```

---

## 2. Tecnologias e versões (alvo, fixadas no `package.json`)

| Item | Versão alvo |
|---|---|
| Node.js | 20 LTS |
| Gerenciador | pnpm 9 (workspaces) + Turborepo |
| Backend | NestJS 10 · TypeScript 5.4 |
| Frontend | Next.js 14 (App Router) · React 18 · TypeScript 5.4 |
| Banco | PostgreSQL 16 |
| ORM | Prisma 5 (`Decimal` nativo) |
| Auth | JWT (access + refresh) · Argon2 para hash de senha |
| Validação | Zod (env) · class-validator/DTO (NestJS) |
| UI | CSS Modules + design tokens do protótipo (sem framework pesado) |
| Testes | Vitest (unit) · Jest+Supertest (e2e Nest) · Playwright (1 smoke E2E de login) |
| Lint/format | ESLint + Prettier |
| Fila | Redis 7 + BullMQ (sobe no Docker; **uso real só a partir do Bloco 2**) |

> Sem tecnologias além destas. Redis/BullMQ ficam provisionados mas ociosos no Bloco 1.

---

## 3. Tabelas criadas neste bloco (migração inicial)

Apenas o núcleo da base — **nenhuma** tabela de evento financeiro ainda.

| Tabela | Campos-chave | Observações |
|---|---|---|
| `Organization` | id, name, status, timestamps | raiz do isolamento |
| `MarketplaceAccount` | id, **organizationId**, marketplace, displayName, shopId, sellerId, currency, timezone, status | loja; `lidermolduras` no seed |
| `MarketplaceConnection` | id, marketplaceAccountId, sourceType, connectionStatus, encryptedCredentials, tokenExpiresAt, lastSyncAt, lastError | credenciais **criptografadas**; só estrutura |
| `User` | id, **organizationId**, name, email (único), passwordHash, role, status | Argon2 |
| `Role` (enum) | ADMIN · FINANCIAL · VIEWER | em `packages/shared` |
| `Membership` (opcional) | userId, marketplaceAccountId | acesso do usuário a lojas específicas |
| `AuditLog` | id, organizationId, userId, action, entityType, entityId, beforePayload, afterPayload, metadata, createdAt | preenchido por interceptor |
| `RefreshToken` | id, userId, tokenHash, expiresAt, revokedAt | rotação de refresh |

**Isolamento (decisão §8.4):** toda tabela operacional carrega `organizationId`; tabelas de loja
carregam também `marketplaceAccountId`. Guard de tenant injeta o escopo em todas as queries.
As tabelas de eventos financeiros (com `dedupHash`, `firstSeenBatchId`, etc.) entram no Bloco 3 —
o schema já é desenhado para recebê-las sem quebrar a base.

---

## 4. Autenticação e autorização

- **Login** por e-mail + senha (Argon2). Emite **access JWT** (curto) + **refresh** (rotacionado,
  `RefreshToken` com hash). Logout revoga o refresh.
- **Guards:** `JwtAuthGuard` (autenticação) + `RolesGuard` (`@Roles(ADMIN|FINANCIAL|VIEWER)`) +
  `TenantGuard` (injeta `organizationId`/lojas do usuário; bloqueia acesso cruzado entre lojas).
- **Papéis:** ADMIN (tudo) · FINANCIAL (operar) · VIEWER (só leitura). No Bloco 1, as telas
  existentes já respeitam o papel (ex.: VIEWER não vê botões de escrita).
- Credenciais/tokens **nunca** em logs; segredo de criptografia vem de `.env` (não versionado).

---

## 5. Auditoria

- `AuditInterceptor` registra ações de escrita (login, criar/editar usuário, criar/editar loja,
  alterar papel) em `AuditLog` com `before/after` e `metadata` (ip, userId, timestamp).
- Tela **Configurações → Auditoria** (somente ADMIN) lista os registros com filtro por
  ação/entidade/usuário/período.

---

## 6. Docker, migrações e seed

- `docker-compose.yml`: `postgres:16` (volume persistente) + `redis:7`. `.env.example` com
  `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `REDIS_URL`.
- **Migrações:** `pnpm db:migrate` (Prisma migrate) cria o schema; migração inicial versionada
  em `packages/database/prisma/migrations`.
- **Seed controlado** (`pnpm db:seed`), **claramente de demonstração** (decisão do cliente — não
  confundir com dados reais):
  - 1 `Organization` "Líder Molduras (demo)";
  - 1 `MarketplaceAccount` `lidermolduras`;
  - 3 usuários: `admin@demo`, `financeiro@demo`, `viewer@demo` (senhas de teste, nunca reais);
  - **nenhum** dado financeiro/pedido (esses só a partir do Bloco 3, via importação real).

---

## 7. Telas reais que funcionarão (não mockadas)

Reaproveitando a identidade visual, o menu, tabelas, cards, filtros e badges do protótipo:

| Tela | Funciona de verdade? |
|---|---|
| **Login** | sim — autentica contra a API, cria sessão, trata erro |
| **Layout** (sidebar + topbar + breadcrumbs + seletor de loja) | sim |
| **Dashboard** | sim, porém **vazio de dados financeiros** — mostra estado "sem dados ainda; importe no Bloco 2", KPIs zerados rotulados |
| **Usuários** | sim — listar/criar/editar/desativar, atribuir papel (respeita permissão) |
| **Lojas** | sim — listar/ver a loja `lidermolduras`; estrutura multiloja visível |
| **Configurações → Auditoria** | sim — lista o `AuditLog` real |
| Importações, Conciliação, Pendências, Pedidos, Movimentações, Produtos, Relatórios, Integrações | **presentes no menu, em estado "em breve"** (placeholder honesto) — implementadas nos blocos seguintes |

> Nada de tela fictícia com número inventado: onde ainda não há função, o estado é "vazio/■ em
> breve", não dado falso.

---

## 8. Testes

- **Unit (Vitest):** hashing/verify de senha; emissão/validação de JWT; `RolesGuard`;
  `TenantGuard` (garante que usuário de uma org não acessa outra); serviço de auditoria.
- **e2e (Jest+Supertest):** `POST /auth/login` (sucesso/erro); rota protegida sem token → 401;
  VIEWER em rota de escrita → 403; criar usuário → aparece no `AuditLog`.
- **E2E de UI (Playwright, 1 smoke):** abre `/login`, autentica, chega ao dashboard, navega a
  Usuários. Roda com o Chromium pré-instalado.
- **Isolamento:** teste explícito de que dados de uma `MarketplaceAccount` não vazam para outra.

---

## 9. Critérios de aceite do Bloco 1

- [ ] `docker compose up` sobe Postgres+Redis; `pnpm db:migrate && pnpm db:seed` popula a base demo.
- [ ] `pnpm dev` sobe API e Web; login funciona com os 3 usuários seed.
- [ ] Papéis aplicados (ADMIN/FINANCIAL/VIEWER) nas telas e nas rotas.
- [ ] CRUD de usuários e visualização de loja funcionando, com auditoria gravando `before/after`.
- [ ] Isolamento por organização/loja garantido por guard e coberto por teste.
- [ ] Aparência profissional consistente com o protótipo aprovado.
- [ ] `pnpm lint`, `pnpm typecheck` e `pnpm test` **verdes**.
- [ ] README com instruções de execução local.

## 10. Entregáveis ao concluir o Bloco 1
commit · lista de arquivos · migrações · evidência de lint · evidência de typecheck · resultado
dos testes · instruções de execução · **capturas das telas reais** · limitações conhecidas.
Sem deploy em produção. Sem credenciais reais. Sem avançar ao Bloco 2 sem autorização.

## 11. Arquivos que serão criados/alterados (resumo)
- **Criados:** todo o monorepo da §1 (configs raiz, `apps/api/*`, `apps/web/*`,
  `packages/database/*`, `packages/shared/*`, `docker-compose.yml`, `.env.example`).
- **Alterados:** `README.md` (execução local do Bloco 1). Documentos de `docs/` já atualizados
  nesta etapa. O `index.html` permanece como referência visual (não é removido).
