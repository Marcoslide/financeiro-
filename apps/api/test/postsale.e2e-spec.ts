import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { buildReturnRefund, buildCancellation, buildFailedDelivery } from './fixtures/postsale-workbook';

/**
 * Bloco 4 — materialização real dos três relatórios de pós-venda. Prova as regras
 * críticas: multi-SKU (valor uma vez), Pedido≠Ocorrência≠Item, cruzamento entre
 * relatórios (1 pedido, várias ocorrências), idempotência e exposição financeira.
 */
const prisma = new PrismaClient();
let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;
let accountId: string;

async function login(email = 'admin@demo.local', password = 'Demo@12345') {
  const res = await http.post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}
function imp(type: string, buf: Buffer, name: string) {
  return http.post('/api/post-sale/import').set('Authorization', `Bearer ${token}`)
    .field('marketplaceAccountId', accountId).field('type', type).attach('file', buf, name);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  http = request(app.getHttpServer());
  token = await login();
  const accounts = await http.get('/api/marketplace-accounts').set('Authorization', `Bearer ${token}`);
  accountId = accounts.body[0].id;
  await prisma.postSaleOccurrenceItem.deleteMany({ where: { occurrence: { marketplaceAccountId: accountId } } });
  await prisma.occurrenceStatusHistory.deleteMany({ where: { occurrence: { marketplaceAccountId: accountId } } });
  await prisma.postSaleOccurrence.deleteMany({ where: { marketplaceAccountId: accountId } });
  await prisma.marketplaceOrder.deleteMany({ where: { marketplaceAccountId: accountId } });
  await prisma.postSaleImportBatch.deleteMany({ where: { marketplaceAccountId: accountId } });
}, 60000);

afterAll(async () => { await prisma.$disconnect(); await app?.close(); });

describe('Bloco 4 — importação e materialização', () => {
  it('importa os três relatórios reais (formato) e materializa Pedido/Ocorrência/Item', async () => {
    const r1 = await imp('RETURN_REFUND', buildReturnRefund(), 'return.xlsx');
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.occurrencesSeen).toBe(2); // RET-1, RET-2
    expect(r1.body.itemsSeen).toBe(4); // RET-1 tem 3 itens + RET-2 tem 1
    expect(r1.body.newOccurrences).toBe(2);

    const c1 = await imp('ORDER_CANCELLATION', buildCancellation(), 'cancel.xlsx');
    expect(c1.body.occurrencesSeen).toBe(2);
    const f1 = await imp('FAILED_DELIVERY', buildFailedDelivery(), 'failed.xlsx');
    expect(f1.body.occurrencesSeen).toBe(1);
  });

  it('MULTI-SKU: RET-1 = 1 ocorrência, 3 itens, reembolso contado UMA vez (§6/§86)', async () => {
    const occ = await prisma.postSaleOccurrence.findFirst({
      where: { marketplaceAccountId: accountId, type: 'RETURN_REFUND', naturalKey: 'RET-1' },
      include: { items: true },
    });
    expect(occ).toBeTruthy();
    expect(occ!.items).toHaveLength(3);
    expect(Number(occ!.requestedRefundAmount)).toBe(300); // não 900
  });

  it('CRUZAMENTO: ORDER-X = 1 pedido com 2 ocorrências (cancelamento + falha) (§11/§87)', async () => {
    const order = await prisma.marketplaceOrder.findFirst({
      where: { marketplaceAccountId: accountId, externalOrderId: 'ORDER-X' },
      include: { occurrences: true },
    });
    expect(order).toBeTruthy();
    const types = order!.occurrences.map((o) => o.type).sort();
    expect(types).toEqual(['FAILED_DELIVERY', 'ORDER_CANCELLATION']);
  });

  it('EXPOSIÇÃO: solicitado ≠ prejuízo — RET-1 confirmado 300, RET-2 em risco 50 (§21/§22)', async () => {
    const res = await http.get(`/api/post-sale/exposure?marketplaceAccountId=${accountId}`).set('Authorization', `Bearer ${token}`);
    expect(res.body.confirmedLoss).toBe(300);
    expect(res.body.atRisk).toBe(50);
  });

  it('REIMPORTAÇÃO dos mesmos arquivos → 0 novas ocorrências (idempotente §85)', async () => {
    const r2 = await imp('RETURN_REFUND', buildReturnRefund(), 'return.xlsx');
    const c2 = await imp('ORDER_CANCELLATION', buildCancellation(), 'cancel.xlsx');
    const f2 = await imp('FAILED_DELIVERY', buildFailedDelivery(), 'failed.xlsx');
    expect(r2.body.newOccurrences).toBe(0);
    expect(c2.body.newOccurrences).toBe(0);
    expect(f2.body.newOccurrences).toBe(0);
    const [orders, occ, items] = await Promise.all([
      prisma.marketplaceOrder.count({ where: { marketplaceAccountId: accountId } }),
      prisma.postSaleOccurrence.count({ where: { marketplaceAccountId: accountId } }),
      prisma.postSaleOccurrenceItem.count({ where: { occurrence: { marketplaceAccountId: accountId } } }),
    ]);
    expect(orders).toBe(4); // ORDER-A, B, C, X
    expect(occ).toBe(5); // RET-1, RET-2, cancel-C, cancel-X, failed-X
    expect(items).toBe(7);
  });
});
