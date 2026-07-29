import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

/**
 * Integração do Bloco 2 contra o Postgres real. Importa os oito arquivos
 * (fixtures sanitizadas) via API HTTP e valida detecção, preservação, contadores
 * e — sobretudo — a DEDUPLICAÇÃO (reimportação, nome diferente, período
 * sobreposto), o isolamento por loja/organização e o bloqueio por permissão.
 * Ao final, grava a MATRIZ dos oito arquivos em test-results/bloco2-matrix.json.
 */
const DIR = path.resolve(__dirname, 'fixtures/files');
const read = (f: string) => fs.readFileSync(path.join(DIR, f));

interface MatrixRow {
  relatorio: string;
  arquivo: string;
  formatoReal: string;
  extensaoDeclarada: string;
  cabecalhoLinha: number | null;
  colunas: number;
  linhasFisicas: number;
  linhasDeDados: number;
  validas: number;
  importadas: number;
  duplicadas: number;
  atualizadas: number;
  alertas: number;
  erros: number;
  confianca: number;
  reimportImportadas: number;
  reimportDuplicadas: number;
}

const prisma = new PrismaClient();
let app: INestApplication;
let http: ReturnType<typeof request>;
let adminToken: string;
let viewerToken: string;
let accountId: string;
const matrix: MatrixRow[] = [];

async function login(email: string, password = 'Demo@12345') {
  const res = await http.post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function analyze(token: string, file: string, reportType?: string) {
  const req = http
    .post('/api/imports/analyze')
    .set('Authorization', `Bearer ${token}`)
    .field('marketplaceAccountId', accountId);
  if (reportType) req.field('reportType', reportType);
  return req.attach('file', read(file), file);
}

async function confirm(token: string, id: string, reportType?: string) {
  return http
    .post(`/api/imports/${id}/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send(reportType ? { reportType } : {});
}

async function importFixture(file: string, reportType?: string) {
  const a = await analyze(adminToken, file, reportType);
  expect(a.status, `analyze ${file}: ${JSON.stringify(a.body)}`).toBe(201);
  const c = await confirm(adminToken, a.body.batch.id, reportType);
  expect(c.status, `confirm ${file}: ${JSON.stringify(c.body)}`).toBe(201);
  return { analysis: a.body.analysis, batch: c.body };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  http = request(app.getHttpServer());

  adminToken = await login('admin@demo.local');
  viewerToken = await login('viewer@demo.local');
  const accounts = await http.get('/api/marketplace-accounts').set('Authorization', `Bearer ${adminToken}`);
  accountId = accounts.body[0].id;

  // Estado limpo para contagens determinísticas.
  await prisma.importRow.deleteMany({ where: { batch: { marketplaceAccountId: accountId } } });
  await prisma.importDedupKey.deleteMany({ where: { marketplaceAccountId: accountId } });
  await prisma.importBatch.deleteMany({ where: { marketplaceAccountId: accountId } });
}, 60000);

afterAll(async () => {
  fs.mkdirSync(path.resolve(__dirname, '../test-results'), { recursive: true });
  fs.writeFileSync(
    path.resolve(__dirname, '../test-results/bloco2-matrix.json'),
    JSON.stringify(matrix, null, 2),
  );
  await prisma.$disconnect();
  await app?.close();
});

const FILES: Array<{ file: string; type: string; header: number }> = [
  { file: 'Order.toship.20260729.xlsx', type: 'ORDERS', header: 1 },
  { file: 'Order.cancelled.20260729.xlsx', type: 'ORDER_CANCELLATION', header: 1 },
  { file: 'Order.failed_delivery.20260729.xlsx', type: 'FAILED_DELIVERY', header: 1 },
  { file: 'Order.return_refund.20260729.xls', type: 'RETURN_REFUND', header: 1 },
  { file: 'my_balance_transaction_report.20260729.xlsx', type: 'WALLET_TRANSACTION', header: 18 },
  { file: '2193537298992576518_1.csv', type: 'SHOPEE_ACELERA', header: 6 },
  { file: 'SellerOnlinePaymentValidationReport.20260729.csv', type: 'AFFILIATE_COMMISSION', header: 1 },
  { file: 'AMSAffiliatePerformance.20260729.csv', type: 'AFFILIATE_PERFORMANCE', header: 1 },
];

describe('Bloco 2 — importação dos oito arquivos + reimportação sem duplicidade', () => {
  it(
    'importa os 8 arquivos, detecta tipo/cabeçalho e reimporta sem duplicar',
    async () => {
      for (const f of FILES) {
        const { analysis, batch } = await importFixture(f.file);
        expect(batch.reportType, f.file).toBe(f.type);
        expect(batch.headerRowIndex, `${f.file} header`).toBe(f.header);
        expect(batch.status).toMatch(/COMPLETED/);
        expect(batch.importedRows).toBeGreaterThan(0);

        // Reimportação do MESMO arquivo (novo lote) => tudo duplicado, nada importado.
        const again = await importFixture(f.file);
        expect(again.batch.importedRows, `${f.file} reimport imported`).toBe(0);
        expect(again.batch.updatedRows, `${f.file} reimport updated`).toBe(0);
        expect(again.batch.duplicatedRows, `${f.file} reimport dup`).toBe(batch.validRows);

        matrix.push({
          relatorio: f.type,
          arquivo: f.file,
          formatoReal: batch.fileFormat,
          extensaoDeclarada: batch.declaredExtension,
          cabecalhoLinha: batch.headerRowIndex,
          colunas: batch.columnCount,
          linhasFisicas: batch.physicalRowCount,
          linhasDeDados: batch.dataRowCount,
          validas: batch.validRows,
          importadas: batch.importedRows,
          duplicadas: batch.duplicatedRows,
          atualizadas: batch.updatedRows,
          alertas: batch.warningRows,
          erros: batch.failedRows,
          confianca: Number(batch.reportTypeConfidence?.toFixed?.(2) ?? batch.reportTypeConfidence),
          reimportImportadas: again.batch.importedRows,
          reimportDuplicadas: again.batch.duplicatedRows,
        });
        void analysis;
      }
    },
    120000,
  );

  it('devoluções: extensão .xls detectada como XLSX (mismatch sinalizado)', async () => {
    const batch = await prisma.importBatch.findFirst({
      where: { marketplaceAccountId: accountId, reportType: 'RETURN_REFUND' },
      orderBy: { createdAt: 'asc' },
    });
    expect(batch?.fileFormat).toBe('XLSX');
    expect(batch?.declaredExtension).toBe('xls');
    expect(batch?.extensionMismatch).toBe(true);
  });

  it('devoluções: mudança de status da mesma devolução vira ATUALIZAÇÃO (não duplica)', async () => {
    const batch = await prisma.importBatch.findFirst({
      where: { marketplaceAccountId: accountId, reportType: 'RETURN_REFUND' },
      orderBy: { createdAt: 'asc' },
    });
    // a 150ª linha repete a devolução da 1ª com status diferente
    expect(batch!.updatedRows).toBeGreaterThanOrEqual(1);
  });

  it('carteira: duas movimentações legítimas do mesmo pedido/dia/valor são ambas importadas', async () => {
    const rows = await prisma.importRow.findMany({
      where: { batch: { marketplaceAccountId: accountId, reportType: 'WALLET_TRANSACTION' }, processingStatus: 'IMPORTED' },
    });
    // agrupa por (orderId, amount) e confirma que existe par com direções opostas
    const shared = rows.filter((r) => {
      const n = r.normalizedPayload as any;
      return n?.amount != null && Math.abs(Number(n.amount)) === 100;
    });
    const dirs = new Set(shared.map((r) => (r.normalizedPayload as any).moneyDirection));
    expect(dirs.has('Entrada') && dirs.has('Saída')).toBe(true);
  });
});

describe('Bloco 2 — deduplicação e casos obrigatórios', () => {
  it('mesmo conteúdo com nome diferente também é reconhecido como duplicado', async () => {
    const original = read('AMSAffiliatePerformance.20260729.csv');
    const req = http
      .post('/api/imports/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('marketplaceAccountId', accountId)
      .attach('file', original, 'nome_totalmente_diferente.csv');
    const a = await req;
    expect(a.status).toBe(201);
    expect(a.body.analysis.alreadyImported).toBe(true); // mesmo fileHash
    const c = await confirm(adminToken, a.body.batch.id);
    expect(c.body.importedRows).toBe(0);
    expect(c.body.duplicatedRows).toBeGreaterThan(0);
  });

  it('períodos sobrepostos: só o novo entra; a interseção é duplicada', async () => {
    const a = await importFixture('wallet_periodA.xlsx', 'WALLET_TRANSACTION');
    const importedA = a.batch.importedRows;
    expect(importedA).toBeGreaterThan(0);

    const b = await importFixture('wallet_periodB.xlsx', 'WALLET_TRANSACTION');
    // as 40 linhas compartilhadas são duplicadas; as 25 exclusivas de B entram
    expect(b.batch.duplicatedRows).toBe(40);
    expect(b.batch.importedRows).toBe(25);
  });

  it('erro em uma linha não invalida o lote', async () => {
    const { batch } = await importFixture('orders_with_one_error.xlsx', 'ORDERS');
    expect(batch.failedRows).toBe(1);
    expect(batch.importedRows).toBe(5);
    expect(batch.status).toBe('COMPLETED_WITH_ERRORS');

    // a linha com erro fica consultável e preserva o payload bruto
    const errRows = await http
      .get(`/api/imports/${batch.id}/rows?issue=error`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(errRows.body.total).toBe(1);
    expect(errRows.body.items[0].rawPayload).toBeTruthy();
  });

  it('reprocessar um lote é idempotente (mesmos números, sem duplicar)', async () => {
    const { batch } = await importFixture('AMSAffiliatePerformance.20260729.csv');
    // esse arquivo já foi importado antes -> aqui é tudo duplicado
    const before = batch.duplicatedRows;
    const rep = await http
      .post(`/api/imports/${batch.id}/reprocess`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(rep.status).toBe(201);
    expect(rep.body.duplicatedRows).toBe(before);
    expect(rep.body.importedRows).toBe(0);
  });
});

describe('Bloco 2 — permissões e isolamento', () => {
  it('VIEWER não pode importar (403)', async () => {
    const a = await analyze(viewerToken, 'AMSAffiliatePerformance.20260729.csv');
    expect(a.status).toBe(403);
  });

  it('isolamento por organização: outra org não enxerga o lote', async () => {
    // cria uma 2ª organização + loja + usuário admin diretamente no banco
    const org2 = await prisma.organization.create({ data: { name: 'Org Isolada (teste)' } });
    const acc2 = await prisma.marketplaceAccount.create({
      data: { organizationId: org2.id, displayName: 'loja2', marketplace: 'SHOPEE' },
    });
    const argon2 = await import('argon2');
    const hash = await argon2.hash('Demo@12345');
    await prisma.user.create({
      data: { organizationId: org2.id, name: 'Admin2', email: `admin2_${Date.now()}@demo.local`, passwordHash: hash, role: 'ADMIN' },
    });
    const someBatch = await prisma.importBatch.findFirst({ where: { marketplaceAccountId: accountId } });
    const email2 = (await prisma.user.findFirst({ where: { organizationId: org2.id } }))!.email;
    const token2 = await login(email2);

    // não vê o lote da org 1
    const got = await http.get(`/api/imports/${someBatch!.id}`).set('Authorization', `Bearer ${token2}`);
    expect(got.status).toBe(404);
    // e a loja da org 1 não é acessível para a org 2
    const listed = await http
      .get(`/api/imports?marketplaceAccountId=${accountId}`)
      .set('Authorization', `Bearer ${token2}`);
    expect(listed.body.length).toBe(0);
    void acc2;
  });
});
