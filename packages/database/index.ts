export * from '@prisma/client';
export { PrismaClient } from '@prisma/client';

/**
 * Fase 10.2 — catálogo único de permissões (item 10/11) e templates de perfil
 * (item 8) do "Sistema Marketplace — Líder". Fonte única de verdade: tanto o
 * seed de demonstração (prisma/seed.ts) quanto o bootstrap de uma organização
 * nova (apps/api/src/auth/auth.service.ts) chamam seedPermissionsAndRoles()
 * daqui — nunca duplicam a lista em outro lugar.
 *
 * Vive inline neste index.ts (em vez de um arquivo `permissions.ts` separado
 * com `export * from './permissions'`) porque o loader usado pelo `nest
 * start --watch` (apps/api) não resolve imports relativos sem extensão
 * dentro deste pacote — só o import de pacotes externos (`@prisma/client`)
 * funciona nesse modo; um `tsx prisma/seed.ts` isolado resolveria bem, mas
 * quebraria o servidor de dev. Adição pura: nenhuma tabela/rota já existente
 * é alterada por este arquivo.
 */
import type { PrismaClient as PrismaClientType } from '@prisma/client';

export interface PermissionDef {
  key: string;
  module: string;
  label: string;
}

/** item 10 — permissões por módulo×ação. item 11 — permissões financeiras sensíveis. */
export const PERMISSION_CATALOG: PermissionDef[] = [
  // Pedidos
  { key: 'orders.view', module: 'orders', label: 'Ver pedidos' },
  { key: 'orders.create', module: 'orders', label: 'Criar pedido manual' },
  { key: 'orders.edit', module: 'orders', label: 'Editar pedido' },
  // Expedição
  { key: 'expedition.view', module: 'expedition', label: 'Ver expedição' },
  { key: 'expedition.execute', module: 'expedition', label: 'Executar expedição (bipar/conferir)' },
  // Produtos
  { key: 'products.view', module: 'products', label: 'Ver produtos' },
  { key: 'products.edit', module: 'products', label: 'Editar produtos' },
  { key: 'products.cost.view', module: 'products', label: 'Ver custo do produto (módulo Produtos)' },
  { key: 'products.cost.edit', module: 'products', label: 'Editar custo do produto' },
  { key: 'pricing.view', module: 'products', label: 'Ver precificação' },
  { key: 'pricing.edit', module: 'products', label: 'Editar precificação' },
  // Devoluções
  { key: 'returns.view', module: 'returns', label: 'Ver devoluções/casos' },
  { key: 'returns.edit', module: 'returns', label: 'Editar devoluções/casos' },
  // Afiliados
  { key: 'affiliates.view', module: 'affiliates', label: 'Ver afiliados' },
  // Minha Renda
  { key: 'income.view', module: 'income', label: 'Ver Minha Renda' },
  // Carteira
  { key: 'wallet.view', module: 'wallet', label: 'Ver carteira' },
  { key: 'wallet.classify', module: 'wallet', label: 'Classificar movimentações da carteira' },
  // Caixa
  { key: 'cash.view', module: 'cash', label: 'Ver caixa' },
  { key: 'cash.close', module: 'cash', label: 'Fechar caixa' },
  { key: 'cash.reopen', module: 'cash', label: 'Reabrir caixa' },
  // Contas a Pagar
  { key: 'ap.view', module: 'ap', label: 'Ver contas a pagar' },
  { key: 'ap.create', module: 'ap', label: 'Criar conta a pagar' },
  { key: 'ap.edit', module: 'ap', label: 'Editar conta a pagar' },
  { key: 'ap.pay', module: 'ap', label: 'Baixar pagamento' },
  { key: 'ap.cancel', module: 'ap', label: 'Cancelar/excluir conta a pagar' },
  // Contas a Receber
  { key: 'ar.view', module: 'ar', label: 'Ver contas a receber' },
  { key: 'ar.create', module: 'ar', label: 'Criar conta a receber' },
  { key: 'ar.edit', module: 'ar', label: 'Editar conta a receber' },
  { key: 'ar.receive', module: 'ar', label: 'Baixar recebimento' },
  // DRE
  { key: 'dre.view', module: 'dre', label: 'Ver DRE' },
  // Fator de Custo Industrial
  { key: 'industrial_cost.view', module: 'industrial_cost', label: 'Ver Fator de Custo Industrial' },
  { key: 'industrial_cost.edit', module: 'industrial_cost', label: 'Editar Fator de Custo Industrial' },
  // Administração
  { key: 'users.view', module: 'admin', label: 'Ver usuários' },
  { key: 'users.create', module: 'admin', label: 'Criar usuário' },
  { key: 'users.edit', module: 'admin', label: 'Editar usuário' },
  { key: 'users.disable', module: 'admin', label: 'Desativar usuário' },
  { key: 'roles.view', module: 'admin', label: 'Ver perfis' },
  { key: 'roles.edit', module: 'admin', label: 'Criar/editar perfis' },
  { key: 'audit.view', module: 'admin', label: 'Ver auditoria' },
  { key: 'settings.manage', module: 'admin', label: 'Gerenciar configurações' },
  // Transversais
  { key: 'imports.execute', module: 'general', label: 'Executar importações' },
  { key: 'exports.execute', module: 'general', label: 'Executar exportações' },
  // item 11 — dados financeiros sensíveis (cross-cutting: mascaram Ficha 360 e afins)
  { key: 'financial.view', module: 'sensitive', label: 'Ver dados financeiros do pedido (taxas/renda)' },
  { key: 'profit.view', module: 'sensitive', label: 'Ver lucro/margem' },
  { key: 'product_cost.view', module: 'sensitive', label: 'Ver custo do produto na ficha do pedido' },
  { key: 'payroll.view', module: 'sensitive', label: 'Ver folha de pagamento' },
];

const ALL = PERMISSION_CATALOG.map((p) => p.key);

const FINANCIAL_KEYS = [
  'income.view', 'wallet.view', 'wallet.classify', 'cash.view', 'cash.close', 'cash.reopen',
  'ap.view', 'ap.create', 'ap.edit', 'ap.pay', 'ap.cancel',
  'ar.view', 'ar.create', 'ar.edit', 'ar.receive',
  'dre.view', 'exports.execute',
  'financial.view', 'profit.view', 'product_cost.view', 'payroll.view',
];

const OPERATION_KEYS = ['orders.view', 'orders.edit', 'expedition.view', 'expedition.execute', 'products.view'];

const POSTSALE_KEYS = ['orders.view', 'returns.view', 'returns.edit'];

const PRODUCTS_KEYS = ['products.view', 'products.edit'];

const VIEWER_KEYS = [
  'orders.view', 'expedition.view', 'products.view', 'returns.view', 'income.view',
  'wallet.view', 'cash.view', 'ap.view', 'ar.view', 'dre.view', 'affiliates.view',
];

export interface AppRoleTemplate {
  key: string;
  name: string;
  permissions: string[];
}

/** item 8 — os 7 perfis de partida. */
export const APP_ROLE_TEMPLATES: AppRoleTemplate[] = [
  { key: 'OWNER', name: 'Proprietário', permissions: ALL },
  { key: 'ADMIN', name: 'Administrador', permissions: ALL },
  { key: 'FINANCIAL', name: 'Financeiro', permissions: FINANCIAL_KEYS },
  { key: 'OPERATION', name: 'Operação', permissions: OPERATION_KEYS },
  { key: 'POSTSALE', name: 'Pós-venda', permissions: POSTSALE_KEYS },
  { key: 'PRODUCTS', name: 'Produtos', permissions: PRODUCTS_KEYS },
  { key: 'VIEWER', name: 'Consulta', permissions: VIEWER_KEYS },
];

/**
 * Idempotente: garante o catálogo global de permissões e, para a organização
 * informada, os 7 perfis-template (isSystem=true — nunca apagados, só
 * desativados) já com suas permissões padrão linkadas. Chamado no bootstrap
 * da primeira organização e no seed de demonstração.
 */
export async function seedPermissionsAndRoles(prisma: PrismaClientType, organizationId: string): Promise<void> {
  const permissionIdByKey = new Map<string, string>();
  for (const p of PERMISSION_CATALOG) {
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, label: p.label },
      create: p,
    });
    permissionIdByKey.set(p.key, row.id);
  }

  for (const tpl of APP_ROLE_TEMPLATES) {
    const role = await prisma.appRole.upsert({
      where: { organizationId_key: { organizationId, key: tpl.key } },
      update: { name: tpl.name, isSystem: true },
      create: { organizationId, key: tpl.key, name: tpl.name, isSystem: true },
    });
    for (const permKey of tpl.permissions) {
      const permissionId = permissionIdByKey.get(permKey);
      if (!permissionId) continue;
      await prisma.appRolePermission.upsert({
        where: { appRoleId_permissionId: { appRoleId: role.id, permissionId } },
        update: {},
        create: { appRoleId: role.id, permissionId },
      });
    }
  }
}
