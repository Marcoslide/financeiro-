# Backlog do vNext

Itens deliberadamente fora do hotfix `v1.0.1`. Eles exigem mudança arquitetural ou uma revisão transversal que não é segura sobre a V1 certificada.

## Segurança e isolamento dos dados de negócio (QA bug 2)

Hoje, pedidos, produtos, caixa, contas e demais dados operacionais vivem no IndexedDB. O RBAC do frontend controla a interface, mas não impede leitura direta dos stores pelo DevTools nem isola os dados por usuário ou organização.

No vNext, mover os dados sensíveis para uma API autenticada, com autorização, isolamento por tenant/organização e auditoria no servidor. Ocultar rotas ou controles no navegador não deve ser considerado uma fronteira de segurança.

Motivo para não corrigir no hotfix: a solução real altera modelo de persistência, contratos de API, migração de dados e arquitetura de autorização. A mitigação imediata da `v1.0.1` limita-se a apagar os dados locais no logout.

## Carregamento inicial e estratégia de distribuição (QA bug 6)

O aplicativo é distribuído como um HTML único e autocontido, incluindo JavaScript e SheetJS. Isso aumenta o download, parsing e tempo de disponibilidade inicial e impede code splitting/lazy loading eficaz.

No vNext, avaliar bundles externos versionados, carregamento sob demanda da importação XLSX, code splitting, métricas de Web Vitals e cache longo apenas para assets com hash. Manter o HTML de entrada com cache curto.

Motivo para não corrigir no hotfix: separar o artefato mudaria a estratégia deliberada de build, publicação e rollback da V1. A `v1.0.1` adiciona compressão HTTP e cache conservador de uma hora sem romper o arquivo único.

## Operação em memória e recuperação (QA bug 5 — complemento)

A `v1.0.1` reforça o alerta persistente e acessível de que qualquer alteração será perdida. O fallback continua disponível para consulta e contingência.

No vNext, identificar ações mutáveis por fluxo e adicionar confirmação única e contextual, telemetria da falha e exportação/recuperação antes de continuar. Não implementar a confirmação no primitivo compartilhado `putMany`/`delOne`, pois ele também atende rotinas internas e importações em lote e poderia gerar prompts repetidos ou interromper operações aprovadas.

## Acessibilidade de diálogos e formulários (QA bug 8 — complemento)

A `v1.0.1` entrega foco visível global e navegação do menu por teclado.

No vNext, completar nomes acessíveis dos botões de ícone, associação `label`/`for`, `role="dialog"`, `aria-modal`, títulos anunciáveis, retorno de foco e focus trap nos modais/drawers. A aplicação possui diversos componentes dinâmicos e o trabalho deve ser feito e testado de forma transversal, não por substituição global arriscada no hotfix.
