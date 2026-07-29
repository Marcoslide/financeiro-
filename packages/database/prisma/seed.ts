/**
 * Seed CONTROLADO e claramente de DEMONSTRAÇÃO (Bloco 1).
 * - 1 organização, 1 loja (lidermolduras), 3 usuários (admin/financeiro/viewer).
 * - NENHUM dado financeiro/pedido (esses só a partir do Bloco 3, via importação real).
 * As senhas abaixo são de teste local; nunca use credenciais reais.
 */
import { PrismaClient, Role, EntityStatus, IngestionSource, ConnectionStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo@12345'; // senha de teste local — NÃO é credencial real

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: 'org_demo_lider' },
    update: {},
    create: {
      id: 'org_demo_lider',
      name: 'Líder Molduras (demonstração)',
      status: EntityStatus.ACTIVE,
    },
  });

  const account = await prisma.marketplaceAccount.upsert({
    where: {
      organizationId_marketplace_displayName: {
        organizationId: org.id,
        marketplace: 'SHOPEE',
        displayName: 'lidermolduras',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      marketplace: 'SHOPEE',
      displayName: 'lidermolduras',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      status: EntityStatus.ACTIVE,
    },
  });

  // Conexão de upload manual (ativa) + placeholders das APIs (só estrutura).
  await prisma.marketplaceConnection.upsert({
    where: {
      marketplaceAccountId_sourceType: {
        marketplaceAccountId: account.id,
        sourceType: IngestionSource.MANUAL_UPLOAD,
      },
    },
    update: {},
    create: {
      marketplaceAccountId: account.id,
      sourceType: IngestionSource.MANUAL_UPLOAD,
      connectionStatus: ConnectionStatus.CONFIGURED,
    },
  });

  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const users: Array<{ email: string; name: string; role: Role }> = [
    { email: 'admin@demo.local', name: 'Admin (demo)', role: Role.ADMIN },
    { email: 'financeiro@demo.local', name: 'Financeiro (demo)', role: Role.FINANCIAL },
    { email: 'viewer@demo.local', name: 'Consulta (demo)', role: Role.VIEWER },
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, name: u.name },
      create: {
        organizationId: org.id,
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
        status: EntityStatus.ACTIVE,
      },
    });
    await prisma.membership.upsert({
      where: {
        userId_marketplaceAccountId: {
          userId: user.id,
          marketplaceAccountId: account.id,
        },
      },
      update: {},
      create: { userId: user.id, marketplaceAccountId: account.id },
    });
  }

  console.log('Seed de demonstração concluído:');
  console.log('  organização:', org.name);
  console.log('  loja:', account.displayName);
  console.log('  usuários:', users.map((u) => `${u.email} (${u.role})`).join(', '));
  console.log('  senha de teste:', DEMO_PASSWORD);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
