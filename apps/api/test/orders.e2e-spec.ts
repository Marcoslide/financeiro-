import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { buildOrders, buildOrdersStatusChanged } from './fixtures/orders-workbook';

/**
 * Módulo Pedidos — importação idempotente (upsert), multi-item com financeiro
 * contado uma vez, normalização de status, snapshot de custo e integração Produtos.
 * §43-§46: testes reais executados contra o pipeline HTTP.
 */
const prisma = new PrismaClient();
let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;
let accountId: string;
let orgId: string;

async function login(email = 'admin@demo.local', password = 'Demo@12345') {
  const res = await http.post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}
function imp(buf: Buffer, name: string) {
  return http.post('/api/orders/import').set('Authorization', `Bearer ${token}`)
    .field('marketplaceAccountId', accountId).attach('file', buf, name);
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
  const acc = await prisma.marketplaceAccount.findUnique({ where: { id: accountId } });
  orgId = acc!.organizationId;

  // Limpa pedidos anteriores da conta.
  await prisma.orderStatusHistory.deleteMany({ where: { order: { marketplaceAccountId: accountId } } });
  await prisma.marketplaceOrderItem.deleteMany({ where: { order: { marketplaceAccountId: accountId } } });
  await prisma.salesImportBatch.deleteMany({ where: { marketplaceAccountId: accountId } });
  // Pedidos podem estar ligados a ocorrências — só apaga os sem ocorrência p/ não quebrar pós-venda.
  await prisma.marketplaceOrder.deleteMany({ where: { marketplaceAccountId: accountId, occurrences: { none: {} } } });

  // Catálogo mínimo: SKU-1 vinculado a uma família com custo 30 (§21/§22).
  await prisma.marketplaceOrderItem.deleteMany({ where: { sku: { in: ['SKU-1', 'SKU-2', 'SKU-3'] }, order: { marketplaceAccountId: accountId } } });
  const fam = await prisma.productFamily.create({
    data: { organizationId: orgId, marketplaceAccountId: accountId, name: 'Fam Teste Pedidos', normalizedName: 'fam teste pedidos', currentCostAmount: '30', currentCostEffectiveFrom: new Date('2026-07-01') },
  });
  const prod = await prisma.product.create({
    data: { organizationId: orgId, marketplaceAccountId: accountId, shopeeProductId: 'P-TEST-ORD', name: 'Produto Teste Pedidos' },
  });
  await prisma.productVariation.create({
    data: { organizationId: orgId, marketplaceAccountId: accountId, productId: prod.id, shopeeVariationId: 'V1', variationKey: 'SKU-1', sku: 'SKU-1', familyId: fam.id },
  });
}, 60000);

afterAll(async () => { await prisma.$disconnect(); await app?.close(); });

describe('Pedidos — importação e materialização', () => {
  it('TESTE 1: primeira importação cria 4 pedidos e 5 itens (§15/§43)', async () => {
    const r = await imp(buildOrders(), 'orders.xlsx');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.ordersSeen).toBe(4);
    expect(r.body.newOrders).toBe(4);
    expect(r.body.itemsSeen).toBe(5);
    expect(r.body.newItems).toBe(5);
  });

  it('TESTE 5: reimportar o MESMO arquivo → 0 novos, 0 duplicações (§9/§43)', async () => {
    const r = await imp(buildOrders(), 'orders.xlsx');
    expect(r.body.newOrders).toBe(0);
    expect(r.body.newItems).toBe(0);
    expect(r.body.unchangedOrders).toBe(4);
    const [orders, items] = await Promise.all([
      prisma.marketplaceOrder.count({ where: { marketplaceAccountId: accountId, externalOrderId: { startsWith: 'ORD-' } } }),
      prisma.marketplaceOrderItem.count({ where: { order: { marketplaceAccountId: accountId }, sku: { in: ['SKU-1', 'SKU-2', 'SKU-3', 'SKU-UNK'] } } }),
    ]);
    expect(orders).toBe(4);
    expect(items).toBe(5);
  });

  it('MULTI-ITEM: ORD-2 = 1 pedido, 2 itens, financeiro contado UMA vez (§17/§44)', async () => {
    const o = await prisma.marketplaceOrder.findFirst({ where: { marketplaceAccountId: accountId, externalOrderId: 'ORD-2' }, include: { items: true } });
    expect(o).toBeTruthy();
    expect(o!.items).toHaveLength(2);
    expect(Number(o!.totalAmount)).toBe(400); // não 800
    expect(Number(o!.commissionNet)).toBe(40); // não 80
    // fees = comissão 40 + serviço 20 + transação 8 = 68 (uma vez)
    expect(Number(o!.marketplaceFeesTotal)).toBe(68);
  });

  it('CUSTO: SKU-1 vinculado usa custo da família (30); SKU-UNK fica pendente (§22/§24/§45)', async () => {
    const o1 = await prisma.marketplaceOrder.findFirst({ where: { marketplaceAccountId: accountId, externalOrderId: 'ORD-1' }, include: { items: true } });
    const item1 = o1!.items[0];
    expect(item1.skuLinked).toBe(true);
    expect(Number(item1.costUnit)).toBe(30);
    expect(Number(item1.costTotal)).toBe(30);
    // resultado ORD-1: receita 100 − taxas (10+5+2=17) − custo 30 = 53
    expect(Number(o1!.estimatedResult)).toBe(53);
    expect(o1!.costPending).toBe(false);

    const o3 = await prisma.marketplaceOrder.findFirst({ where: { marketplaceAccountId: accountId, externalOrderId: 'ORD-3' } });
    expect(o3!.costPending).toBe(true); // SKU não vinculado → nunca custo 0
    expect(o3!.estimatedResult).toBeNull(); // lucro não afirmado
  });

  it('STATUS normalizado alimenta abas: Concluído/Cancelado/Enviado/A_ENVIAR (§13)', async () => {
    const rows = await prisma.marketplaceOrder.findMany({ where: { marketplaceAccountId: accountId, externalOrderId: { in: ['ORD-1', 'ORD-2', 'ORD-3', 'ORD-4'] } }, select: { externalOrderId: true, normalizedStatus: true } });
    const map = Object.fromEntries(rows.map((r) => [r.externalOrderId, r.normalizedStatus]));
    expect(map['ORD-1']).toBe('A_ENVIAR');
    expect(map['ORD-2']).toBe('CONCLUIDO');
    expect(map['ORD-3']).toBe('CANCELADO');
    expect(map['ORD-4']).toBe('ENVIADO'); // "Entregue" → ENVIADO
  });

  it('TESTE 4/6: ORD-1 A_ENVIAR→ENVIADO + rastreamento → 1 atualizado, histórico, muda de aba (§6/§12/§14)', async () => {
    const r = await imp(buildOrdersStatusChanged(), 'orders-2.xlsx');
    expect(r.body.newOrders).toBe(0);
    expect(r.body.updatedOrders).toBe(1);
    const o = await prisma.marketplaceOrder.findFirst({ where: { marketplaceAccountId: accountId, externalOrderId: 'ORD-1' }, include: { statusHistory: true } });
    expect(o!.normalizedStatus).toBe('ENVIADO');
    expect(o!.trackingNumber).toBe('BR123456789');
    const fields = o!.statusHistory.map((h) => h.field).sort();
    expect(fields).toContain('status');
    expect(fields).toContain('trackingNumber');
    // Aparece na aba ENVIADO, não mais em A_ENVIAR.
    const enviado = await http.get(`/api/orders?marketplaceAccountId=${accountId}&tab=ENVIADO&search=ORD-1`).set('Authorization', `Bearer ${token}`);
    expect(enviado.body.items.some((x: { externalOrderId: string }) => x.externalOrderId === 'ORD-1')).toBe(true);
    const aenviar = await http.get(`/api/orders?marketplaceAccountId=${accountId}&tab=A_ENVIAR&search=ORD-1`).set('Authorization', `Bearer ${token}`);
    expect(aenviar.body.items.some((x: { externalOrderId: string }) => x.externalOrderId === 'ORD-1')).toBe(false);
  });

  it('DASHBOARD determinístico responde com indicadores (§38)', async () => {
    const r = await http.get(`/api/orders/dashboard?marketplaceAccountId=${accountId}`).set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.orders).toBeGreaterThanOrEqual(4);
    expect(typeof r.body.estimatedResult).toBe('number');
    expect(r.body.costPendingOrders).toBeGreaterThanOrEqual(1);
  });
});
