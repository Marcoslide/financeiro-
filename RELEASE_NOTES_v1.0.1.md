# Release notes — v1.0.1

Hotfix preparado sobre a V1 certificada `6977589ca573f5ef8338665030d582580ac511af` (`v1.0.0-certified`). A tag certificada não foi movida ou reescrita. Esta preparação não inclui deploy.

## Corrigido

- **QA 1 — logout:** esvazia os 60 stores locais, fecha a conexão e solicita a exclusão do IndexedDB antes de recarregar, inclusive quando `/auth/logout` falha.
- **QA 3 — mobile:** em até 768 px, recolhe a sidebar para 68 px, reduz paddings e preserva 307 px de conteúdo útil em viewport de 375 px, sem overflow da página.
- **QA 4 — teclado:** os 14 itens do menu agora são links focáveis com `href="#/<rota>"`, mantendo o roteamento SPA existente.
- **QA 7 — entrega do HTML:** habilita Brotli/Gzip, ETag e cache conservador de uma hora para os arquivos estáticos.
- **QA 9 — headers:** habilita Helmet com os headers seguros padrão e `contentSecurityPolicy: false` explícito para preservar o JavaScript inline da V1.

## Mitigado neste hotfix

- **QA 5 — fallback em memória:** o aviso persistente agora é crítico, inequívoco e anunciado como alerta. Confirmações contextuais e recuperação/exportação foram mantidas no backlog para evitar prompts repetidos em rotinas internas e importações em lote.
- **QA 8 — acessibilidade:** adiciona foco visível global de alto contraste. ARIA de diálogos, nomes dos botões de fechar, associação de labels e focus trap foram mantidos no backlog por exigirem revisão transversal dos componentes dinâmicos.

## Backlog vNext

- **QA 2:** mover dados de negócio para backend com autorização e isolamento por tenant; RBAC visual não protege IndexedDB.
- **QA 6:** rever o HTML autocontido, aplicar code splitting e lazy-load de XLSX sem comprometer build, publicação e rollback.
- Complementos dos bugs 5 e 8 estão detalhados em `BACKLOG_VNEXT.md`.

## Validação local

- `pnpm typecheck`: 5 tarefas aprovadas.
- `pnpm --filter @financeiro/api build`: aprovado.
- API: 12 arquivos e 114 testes aprovados contra PostgreSQL DEV isolado.
- HTTP local: HTML `200`, `Content-Encoding: br`, `Cache-Control: public, max-age=3600`, ETag e headers Helmet; `/api/health` e login DEV responderam `200`.
- Navegador: login, Dashboard, Pedidos, Caixa e Produtos funcionais; console sem erro; viewport 375 px com grid `68px 307px` e largura total de 375 px.

## Não alterado

- Regras, fórmulas e cálculos financeiros.
- Modelo de persistência da V1 e IndexedDB durante a sessão.
- Tag `v1.0.0-certified`, produção, VPS, Docker e banco de produção.
