import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { buildProductWorkbook, BASE_ROWS } from './fixtures/product-workbook';

/**
 * Integração do Bloco 3 (Produtos + Variações + Famílias + Custos + Importador)
 * contra o Postgres real. Prova, de ponta a ponta, os critérios de aceite do
 * prompt (§25/§26): reconhecimento do cabeçalho fora da linha 1, agrupamento por
 * anúncio, reimportação sem duplicar, sincronização de preço/estoque sem destruir
 * família/preço de fechamento, histórico de custo e permissões.
 */
const prisma = new PrismaClient();
let app: INestApplication;
let http: ReturnType<typeof request>;
let adminToken: string;
let viewerToken: string;
let accountId: string;

async function login(email: string, password = 'Demo@12345') {
  const res = await http.post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

function importProducts(token: string, buffer: Buffer, filename = 'produtos.xlsx') {
  return http
    .post('/api/products/import')
    .set('Authorization', `Bearer ${token}`)
    .field('marketplaceAccountId', accountId)
    .attach('file', buffer, filename);
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
  await prisma.productImportBatch.deleteMany({ where: { marketplaceAccountId: accountId } });
  await prisma.productVariation.deleteMany({ where: { marketplaceAccountId: accountId } });
  await prisma.product.deleteMany({ where: { marketplaceAccountId: accountId } });
  await prisma.productFamily.deleteMany({ where: { marketplaceAccountId: accountId } });
}, 60000);

afterAll(async () => {
  await prisma.$disconnect();
  await app?.close();
});

describe('Bloco 3 — importação do catálogo de produtos', () => {
  it('reconhece o cabeçalho fora da linha 1, agrupa por anúncio e reporta os números reais', async () => {
    const res = await importProducts(adminToken, buildProductWorkbook());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const s = res.body;
    // Cabeçalho na linha 3; dados a partir da linha 7 (linhas técnicas/instrução ignoradas).
    expect(s.headerRowIndex).toBe(3);
    expect(s.dataStartRowIndex).toBe(7);
    expect(s.ignoredRows).toBe(3);
    // 3 anúncios válidos, 7 variações; 1 linha com erro (sem Nome do Produto).
    expect(s.productsSeen).toBe(3);
    expect(s.variationsSeen).toBe(7);
    expect(s.newProducts).toBe(3);
    expect(s.newVariations).toBe(7);
    expect(s.errorRows).toBe(1);
    expect(s.errors[0].message).toMatch(/Nome do Produto/);
    expect(s.status).toBe('COMPLETED_WITH_ERRORS');
  });

  it('as variações ficam agrupadas dentro do anúncio, cada uma com seu SKU/preço/estoque', async () => {
    const list = await http
      .get(`/api/products?marketplaceAccountId=${accountId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const paisagem = list.body.items.find((p: any) => p.shopeeProductId === '43819067914');
    expect(paisagem).toBeTruthy();
    expect(paisagem.variationCount).toBe(4);
    expect(paisagem.priceMin).toBe('199.90');
    expect(paisagem.priceMax).toBe('479.00');
    const v5070 = paisagem.variations.find((v: any) => v.sku === 'SKU-5070-PT');
    expect(v5070.shopeeFullPrice).toBe('269');
    expect(v5070.sellerStock).toBe(8);

    // Anúncio de variação única: agrupado pelo SKU (Variante Identificador vazio).
    const mandala = list.body.items.find((p: any) => p.shopeeProductId === '55500000002');
    expect(mandala.variationCount).toBe(1);
  });

  it('reimportar o MESMO arquivo não duplica nada (idempotente)', async () => {
    const res = await importProducts(adminToken, buildProductWorkbook());
    const s = res.body;
    expect(s.newProducts).toBe(0);
    expect(s.newVariations).toBe(0);
    expect(s.updatedRecords).toBe(0);
    expect(s.unchangedRecords).toBe(7);

    const [products, variations] = await Promise.all([
      prisma.product.count({ where: { marketplaceAccountId: accountId } }),
      prisma.productVariation.count({ where: { marketplaceAccountId: accountId } }),
    ]);
    expect(products).toBe(3);
    expect(variations).toBe(7);
  });
});

describe('Bloco 3 — famílias, custo e classificação em massa', () => {
  let familyId: string;
  let classifiedVariationIds: string[] = [];

  it('cria uma família com custo (gera histórico) e classifica vários SKUs de uma vez', async () => {
    const fam = await http
      .post('/api/products/families')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ marketplaceAccountId: accountId, name: 'Quadro 40x60 Moldura Premium', cost: '32,50' });
    expect(fam.status, JSON.stringify(fam.body)).toBe(201);
    familyId = fam.body.id;
    expect(fam.body.currentCostAmount).toBe('32.5');

    // Seleciona as duas variações 40x60 e classifica em massa.
    const list = await http
      .get(`/api/products?marketplaceAccountId=${accountId}&search=Paisagem`)
      .set('Authorization', `Bearer ${adminToken}`);
    const paisagem = list.body.items.find((p: any) => p.shopeeProductId === '43819067914');
    classifiedVariationIds = paisagem.variations
      .filter((v: any) => v.sku === 'SKU-4060-PT' || v.sku === 'SKU-4060-BR')
      .map((v: any) => v.id);
    expect(classifiedVariationIds).toHaveLength(2);

    const cls = await http
      .post('/api/products/classify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ variationIds: classifiedVariationIds, familyId });
    expect(cls.status).toBe(201);
    expect(cls.body.updated).toBe(2);

    const v = await prisma.productVariation.findUnique({ where: { id: classifiedVariationIds[0] } });
    expect(v?.familyId).toBe(familyId);
  });

  it('define o preço de fechamento em uma variação (não sobrescreve o preço Shopee)', async () => {
    const upd = await http
      .patch(`/api/products/variations/${classifiedVariationIds[0]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ closingPrice: '179,90' });
    expect(upd.status).toBe(200);
    const v = await prisma.productVariation.findUnique({ where: { id: classifiedVariationIds[0] } });
    expect(v?.closingPrice?.toString()).toBe('179.9');
    expect(v?.shopeeFullPrice?.toString()).toBe('199.9'); // preço Shopee intacto
  });

  it('reimportar com estoque/preço alterados SINCRONIZA a Shopee sem destruir família nem preço de fechamento (§15)', async () => {
    // A variação que tem família + preço de fechamento (classifiedVariationIds[0]).
    const target = await prisma.productVariation.findUnique({ where: { id: classifiedVariationIds[0] } });
    const targetSku = target!.sku!;
    // Muda o estoque e o preço Shopee justamente dessa variação.
    const changed = BASE_ROWS.map((r) =>
      r.sku === targetSku ? { ...r, price: '219.90', stock: '99' } : r,
    );
    const res = await importProducts(adminToken, buildProductWorkbook(changed));
    const s = res.body;
    expect(s.newVariations).toBe(0);
    expect(s.updatedRecords).toBe(1); // só a variação alterada
    expect(s.unchangedRecords).toBe(6);

    const v = await prisma.productVariation.findUnique({ where: { id: classifiedVariationIds[0] } });
    // Campos da Shopee atualizados…
    expect(v?.shopeeFullPrice?.toString()).toBe('219.9');
    expect(v?.sellerStock).toBe(99);
    // …e os dados INTERNOS preservados.
    expect(v?.familyId).toBe(familyId);
    expect(v?.closingPrice?.toString()).toBe('179.9');
  });

  it('alterar o custo da família preserva o histórico e resolve o custo vigente (SKU → família → custo)', async () => {
    const upd = await http
      .patch(`/api/products/families/${familyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cost: '36,00' });
    expect(upd.status).toBe(200);
    expect(upd.body.currentCostAmount).toBe('36');

    const detail = await http
      .get(`/api/products/families/${familyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    // Duas entradas de custo no histórico (32,50 → 36,00).
    expect(detail.body.costHistory).toHaveLength(2);

    const entries = await prisma.productFamilyCostHistory.count({ where: { familyId } });
    expect(entries).toBe(2);
  });
});

describe('Bloco 3 — permissões', () => {
  it('VIEWER não pode importar (403)', async () => {
    const res = await importProducts(viewerToken, buildProductWorkbook());
    expect(res.status).toBe(403);
  });

  it('VIEWER não pode criar família (403)', async () => {
    const res = await http
      .post('/api/products/families')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ marketplaceAccountId: accountId, name: 'X' });
    expect(res.status).toBe(403);
  });
});
