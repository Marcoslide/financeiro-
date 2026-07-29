import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

/**
 * Prova que a DEDUPLICAÇÃO e os registros do Bloco 2 são PERSISTIDOS no Postgres
 * e NÃO dependem do estado em memória: importa por uma instância da API, DERRUBA
 * essa instância (fecha app + conexão Prisma), sobe uma instância NOVA (conexão
 * nova = "API reiniciada") e reimporta o mesmo arquivo — deve dar 0 importadas.
 * Depois reconsulta os dados direto do banco (rawPayload, hashes, auditoria).
 */
const FIX = path.resolve(__dirname, 'fixtures/files');
const FILE = 'my_balance_transaction_report.20260729.xlsx';
const prisma = new PrismaClient();

async function boot(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}
// Organização/loja/usuário DEDICADOS a este teste, para não competir com os
// outros specs de integração (que rodam em paralelo sobre a loja do seed).
const ORG_NAME = 'Org Persistência (teste)';
let adminEmail = '';

async function login(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'Demo@12345' });
  return res.body.accessToken as string;
}
async function importar(app: INestApplication, token: string, acc: string) {
  const a = await request(app.getHttpServer())
    .post('/api/imports/analyze')
    .set('Authorization', `Bearer ${token}`)
    .field('marketplaceAccountId', acc)
    .attach('file', fs.readFileSync(path.join(FIX, FILE)), FILE);
  expect(a.status).toBe(201);
  const c = await request(app.getHttpServer())
    .post(`/api/imports/${a.body.batch.id}/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(c.status).toBe(201);
  return c.body;
}

let acc = '';
let orgId = '';
beforeAll(async () => {
  // limpa execuções anteriores deste teste
  const prev = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (prev) await prisma.organization.delete({ where: { id: prev.id } });

  const argon2 = await import('argon2');
  const hash = await argon2.hash('Demo@12345');
  const org = await prisma.organization.create({ data: { name: ORG_NAME } });
  orgId = org.id;
  const account = await prisma.marketplaceAccount.create({
    data: { organizationId: org.id, displayName: 'loja-persistencia', marketplace: 'SHOPEE' },
  });
  acc = account.id;
  adminEmail = `admin_persist_${org.id}@demo.local`;
  const user = await prisma.user.create({
    data: { organizationId: org.id, name: 'Admin Persist', email: adminEmail, passwordHash: hash, role: 'ADMIN' },
  });
  await prisma.membership.create({ data: { userId: user.id, marketplaceAccountId: acc } });
}, 60000);

afterAll(async () => {
  // remove tudo o que este teste criou (cascata a partir da organização)
  if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe('Bloco 2 — persistência da deduplicação após reinício da API', () => {
  it('dedup sobrevive a fechar/abrir a API (estado vem do banco, não da memória)', async () => {
    // Instância 1 — importa
    const app1 = await boot();
    const t1 = await login(app1, adminEmail);
    const first = await importar(app1, t1, acc);
    expect(first.importedRows).toBeGreaterThan(0);
    const importedFirst = first.importedRows;
    await app1.close(); // derruba a API e a conexão Prisma

    // Confirma no banco que as chaves de dedup ficaram PERSISTIDAS
    const keysPersisted = await prisma.importDedupKey.count({ where: { marketplaceAccountId: acc } });
    expect(keysPersisted).toBe(importedFirst);

    // Instância 2 — "API reiniciada" (novo app, nova conexão) reimporta o MESMO arquivo
    const app2 = await boot();
    const t2 = await login(app2, adminEmail);
    const second = await importar(app2, t2, acc);
    expect(second.importedRows).toBe(0); // nada novo — a dedup veio do banco
    expect(second.duplicatedRows).toBe(importedFirst);
    await app2.close();
  }, 60000);

  it('rawPayload é preservado integralmente e hashes (bruto ≠ canônico) persistem', async () => {
    const row = await prisma.importRow.findFirst({
      where: { batch: { marketplaceAccountId: acc } },
      orderBy: { physicalRowNumber: 'asc' },
    });
    expect(row).toBeTruthy();
    const raw = row!.rawPayload as { headers: string[]; values: string[] };
    expect(Array.isArray(raw.headers) && raw.headers.length).toBeGreaterThan(0);
    expect(Array.isArray(raw.values) && raw.values.length).toBeGreaterThan(0);
    expect(raw.headers).toContain('Tipo de transação'); // cabeçalho real preservado
    expect(row!.rawHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.rawHash).not.toBe(row!.canonicalHash);
  });

  it('a importação e a reimportação foram AUDITADAS no banco', async () => {
    const audits = await prisma.auditLog.count({ where: { organizationId: orgId, action: 'IMPORT_CONFIRM' } });
    expect(audits).toBeGreaterThanOrEqual(2); // duas confirmações (import + reimport)
  });

  it('o lote persistido é consultável com os números reais', async () => {
    const batches = await prisma.importBatch.findMany({ where: { marketplaceAccountId: acc }, orderBy: { createdAt: 'asc' } });
    expect(batches.length).toBe(2);
    expect(batches[0].reportType).toBe('WALLET_TRANSACTION');
    expect(batches[0].headerRowIndex).toBe(18);
    expect(batches[0].importedRows).toBeGreaterThan(0);
    expect(batches[1].importedRows).toBe(0); // reimport
    expect(batches[1].duplicatedRows).toBe(batches[0].importedRows);
  });
});
