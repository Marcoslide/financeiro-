import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

/**
 * Devolução — operação alimenta a inteligência (§40-§42). Cenários de aceite:
 * disputa ganha, responsabilidade logística + compensação, e erro nosso + frete
 * reverso. Prova o motor determinístico de IMPACTO LÍQUIDO (reembolso ≠ prejuízo).
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
const auth = () => ({ Authorization: `Bearer ${token}` });

async function seedOccurrence(externalOrderId: string, naturalKey: string): Promise<string> {
  const order = await prisma.marketplaceOrder.upsert({
    where: { marketplaceAccountId_externalOrderId: { marketplaceAccountId: accountId, externalOrderId } },
    create: { organizationId: orgId, marketplaceAccountId: accountId, externalOrderId },
    update: {},
  });
  const occ = await prisma.postSaleOccurrence.upsert({
    where: { marketplaceAccountId_type_naturalKey: { marketplaceAccountId: accountId, type: 'RETURN_REFUND', naturalKey } },
    create: {
      organizationId: orgId, marketplaceAccountId: accountId, orderId: order.id, type: 'RETURN_REFUND',
      naturalKey, externalOrderId, sourceReportType: 'RETURN_REFUND', status: 'Em análise',
    },
    update: { status: 'Em análise' },
  });
  return occ.id;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  http = request(app.getHttpServer());
  token = await login();
  const accounts = await http.get('/api/marketplace-accounts').set(auth());
  accountId = accounts.body[0].id;
  orgId = (await prisma.marketplaceAccount.findUnique({ where: { id: accountId } }))!.organizationId;
}, 60000);

afterAll(async () => { await prisma.$disconnect(); await app?.close(); });

describe('Devolução — cenários de aceite operacionais (§40-§42)', () => {
  it('§40 DISPUTA GANHA: reembolso 200 + frete reverso 38 − recuperação 100 = impacto líquido 138', async () => {
    const id = await seedOccurrence('ACEITE-40', 'ACEITE-40');
    // Estado inicial operacional
    await http.patch(`/api/post-sale/occurrences/${id}`).set(auth()).send({ internalCause: 'Erro de separação', responsibility: 'OPERACAO', internalStatus: 'EM_DISPUTA' }).expect(200);
    // Reembolso pago (custo) e frete reverso (custo)
    await http.post(`/api/post-sale/occurrences/${id}/financial-event`).set(auth()).send({ type: 'REEMBOLSO_PAGO', amount: 200 }).expect(201);
    await http.post(`/api/post-sale/occurrences/${id}/financial-event`).set(auth()).send({ type: 'FRETE_REVERSO', amount: 38 }).expect(201);
    // Operador marca DISPUTA GANHA com recuperação 100
    const r = await http.post(`/api/post-sale/occurrences/${id}/dispute`).set(auth()).send({ result: 'GANHA', recoveredAmount: 100 }).expect(201);
    expect(r.body.impact.refundedTotal).toBe(200);
    expect(r.body.impact.additionalCostTotal).toBe(38);
    expect(r.body.impact.recoveredTotal).toBe(100);
    expect(r.body.impact.knownNetImpact).toBe(138); // 200 + 38 − 100
    expect(r.body.disputeStatus).toBe('GANHA');
    // Timeline registrou a disputa e o financeiro
    const kinds = r.body.activities.map((a: { kind: string }) => a.kind);
    expect(kinds).toContain('DISPUTE');
    expect(kinds).toContain('FINANCIAL');
  });

  it('§41 RESPONSABILIDADE LOGÍSTICA: reembolso 350 − compensação 280 = 70 (produto não retornou)', async () => {
    const id = await seedOccurrence('ACEITE-41', 'ACEITE-41');
    await http.patch(`/api/post-sale/occurrences/${id}`).set(auth()).send({ responsibility: 'LOGISTICA', causeFamily: 'Avaria / Embalagem', merchandiseStatus: 'PERDIDO' }).expect(200);
    await http.post(`/api/post-sale/occurrences/${id}/financial-event`).set(auth()).send({ type: 'REEMBOLSO_PAGO', amount: 350 }).expect(201);
    const r = await http.post(`/api/post-sale/occurrences/${id}/financial-event`).set(auth()).send({ type: 'COMPENSACAO_SHOPEE', amount: 280 }).expect(201);
    expect(r.body.impact.refundedTotal).toBe(350);
    expect(r.body.impact.recoveredTotal).toBe(280);
    expect(r.body.impact.knownNetImpact).toBe(70); // nunca 350 de perda líquida
    expect(r.body.responsibility).toBe('LOGISTICA');
  });

  it('§42 ERRO NOSSO: reembolso 250 + frete reverso 45, produto voltou reaproveitável (custo ≠ só reembolso)', async () => {
    const id = await seedOccurrence('ACEITE-42', 'ACEITE-42');
    await http.patch(`/api/post-sale/occurrences/${id}`).set(auth()).send({ responsibility: 'OPERACAO', internalCause: 'Produto errado', merchandiseStatus: 'RECEBIDO', merchandiseCondition: 'REAPROVEITAVEL' }).expect(200);
    await http.post(`/api/post-sale/occurrences/${id}/financial-event`).set(auth()).send({ type: 'REEMBOLSO_PAGO', amount: 250 }).expect(201);
    const r = await http.post(`/api/post-sale/occurrences/${id}/financial-event`).set(auth()).send({ type: 'FRETE_REVERSO', amount: 45 }).expect(201);
    expect(r.body.impact.refundedTotal).toBe(250);
    expect(r.body.impact.additionalCostTotal).toBe(45); // custo adicional além do reembolso
    expect(r.body.impact.knownNetImpact).toBe(295); // 250 + 45 (recuperável ainda não quantificado)
    expect(r.body.impact.cmvAvailable).toBe(false); // CMV não inventado
    expect(r.body.merchandiseCondition).toBe('REAPROVEITAVEL');
  });

  it('IDEMPOTÊNCIA financeira: reenviar mesmo evento não duplica (§17)', async () => {
    const id = await seedOccurrence('ACEITE-IDEM', 'ACEITE-IDEM');
    const at = '2026-08-01T10:00:00.000Z';
    await http.post(`/api/post-sale/occurrences/${id}/financial-event`).set(auth()).send({ type: 'FRETE_REVERSO', amount: 30, occurredAt: at }).expect(201);
    await http.post(`/api/post-sale/occurrences/${id}/financial-event`).set(auth()).send({ type: 'FRETE_REVERSO', amount: 30, occurredAt: at }).expect(201);
    const count = await prisma.occurrenceFinancialEvent.count({ where: { occurrenceId: id } });
    expect(count).toBe(1); // mesmo dedupeKey → um único evento
  });

  it('AUDITORIA/TIMELINE: mudança de status interno gera atividade com antes/depois (§10/§29)', async () => {
    const id = await seedOccurrence('ACEITE-AUD', 'ACEITE-AUD');
    await http.patch(`/api/post-sale/occurrences/${id}`).set(auth()).send({ internalStatus: 'ANALISE' }).expect(200);
    const r = await http.patch(`/api/post-sale/occurrences/${id}`).set(auth()).send({ internalStatus: 'RESOLVIDA', ownerName: 'Maria' }).expect(200);
    const change = r.body.activities.find((a: { field: string }) => a.field === 'internalStatus');
    expect(change.oldValue).toBe('ANALISE');
    expect(change.newValue).toBe('RESOLVIDA');
  });

  it('ANÁLISE: exec-overview/motivos/produtos-criticos/financeiro/pendências respondem e refletem a operação (§3-§7,§30)', async () => {
    // A operação já lançou perdas/recuperações; a análise deve refletir o estado atual.
    const ov = await http.get(`/api/post-sale/exec-overview?marketplaceAccountId=${accountId}`).set(auth()).expect(200);
    expect(ov.body.indicators.totalOccurrences).toBeGreaterThanOrEqual(3);
    expect(ov.body.indicators.confirmedLoss).toBeGreaterThanOrEqual(138); // ACEITE-40 líquido 138
    expect(Array.isArray(ov.body.whereIsTheError)).toBe(true);
    expect(Array.isArray(ov.body.criticalProducts)).toBe(true);
    expect(ov.body.disputes).toBeTruthy();

    const fin = await http.get(`/api/post-sale/financeiro?marketplaceAccountId=${accountId}`).set(auth()).expect(200);
    expect(fin.body.additionalCostTotal).toBeGreaterThanOrEqual(83); // 38 (§40) + 45 (§42)
    expect(fin.body.knownNetImpact).toBeGreaterThanOrEqual(138);
    expect(fin.body.cmvAvailable).toBe(false);

    await http.get(`/api/post-sale/motivos?marketplaceAccountId=${accountId}`).set(auth()).expect(200);
    await http.get(`/api/post-sale/produtos-criticos?marketplaceAccountId=${accountId}`).set(auth()).expect(200);
    const pend = await http.get(`/api/post-sale/pendencias?marketplaceAccountId=${accountId}`).set(auth()).expect(200);
    expect(Array.isArray(pend.body)).toBe(true);
  });
});
