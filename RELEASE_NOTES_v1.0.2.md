# v1.0.2 — sincronização entre Proprietário e subcontas

## Correção

- As 60 stores operacionais da V1 passam a ser espelhadas no PostgreSQL por `organizationId`.
- Proprietário e subcontas da mesma organização carregam a mesma base ao entrar no sistema.
- Escritas são sincronizadas por store e por ID, com revisão otimista para impedir sobrescrita silenciosa em uso simultâneo.
- Anexos de Contas a Pagar (`File`/`Blob`) são codificados e restaurados sem perda.
- O logout deixa de limpar e excluir o IndexedDB.
- O primeiro acesso de uma subconta continua o boot normalmente após a troca obrigatória de senha.
- Uma sessão sem autenticação não carrega a base operacional atrás do overlay de login.

## Preservado

- Nenhuma fórmula ou regra financeira foi alterada.
- Nenhuma das 60 stores foi removida ou renomeada.
- IndexedDB continua sendo o runtime/cache da V1.
- A release e a tag certificadas não foram alteradas.

## Banco

- Migration aditiva: `20260831174500_organization_workspace_sync`.
- Nova tabela: `organization_workspace_stores`.
- Nenhuma tabela financeira existente é modificada pela migration.
