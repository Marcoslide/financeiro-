/** Formatação em português do Brasil. */
export function money(v: number): string {
  return (v < 0 ? '-' : '') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function dateBR(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrador',
  FINANCIAL: 'Financeiro',
  VIEWER: 'Consulta',
};
