/**
 * E-mail é o login do sistema (item 6 da correção urgente): normaliza para
 * minúsculas sem espaços em todos os pontos de contato (criação, edição,
 * login, bootstrap) para que "Marcos@Empresa.com" e "marcos@empresa.com"
 * sejam sempre o mesmo usuário — nunca duas contas duplicadas.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
