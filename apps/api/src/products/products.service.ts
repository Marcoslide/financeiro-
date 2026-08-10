import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  EntityStatus as DbEntityStatus,
  ImportBatchStatus as DbBatchStatus,
  IngestionSource as DbIngestionSource,
} from '@prisma/client';
import { AuditAction, ProductImportError, ProductImportSummary } from '@financeiro/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FILE_STORAGE, FileStorage } from '../imports/storage';
import { sanitizeFilename } from '../imports/parsing/format';
import { normalizeLabel, parseDecimal } from '../imports/parsing/value-parsers';
import { parseProductSheet, ParsedProductSheet, ProductRowData } from './parsing/product-sheet';
import {
  ClassifyVariationsDto,
  CreateFamilyDto,
  UpdateFamilyDto,
  UpdateVariationDto,
} from './dto';

interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export type ProductSort =
  | 'name_asc'
  | 'name_desc'
  | 'stock_desc'
  | 'stock_asc'
  | 'price_desc'
  | 'price_asc'
  | 'variations_desc'
  | 'variations_asc'
  | 'without_family'
  | 'without_closing';

interface ProductFilters {
  search?: string;
  familyId?: string;
  family?: 'with' | 'without';
  closingPrice?: 'with' | 'without';
  stock?: 'with' | 'without' | 'zero';
  variations?: 'single' | 'multiple';
  status?: 'ACTIVE' | 'INACTIVE';
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
}

type Db = Prisma.TransactionClient;

/** Comparação de decimais tolerante a nulos (evita falsos "alterado"). */
function decChanged(dbValue: Prisma.Decimal | null, parsed: string | null): boolean {
  if (dbValue == null && parsed == null) return false;
  if (dbValue == null || parsed == null) return true;
  try {
    return !dbValue.equals(new Prisma.Decimal(parsed));
  } catch {
    return true;
  }
}

const CHUNK = 500;
function chunk<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// --- Similaridade de tokens para a sugestão de família (heurística) ---
const STOPWORDS = new Set(['de', 'do', 'da', 'com', 'sem', 'para', 'e', 'o', 'a', 'em', 'kit', 'un']);
const SIZE_RE = /^\d{1,3}x\d{1,3}$/;

function tokenize(text: string): Set<string> {
  const norm = normalizeLabel(text);
  const out = new Set<string>();
  for (const raw of norm.split(/[^a-z0-9]+/)) {
    const t = raw.trim();
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}
function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}
function unionSize(a: Set<string>, b: Set<string>): number {
  return a.size + b.size - intersectionSize(a, b);
}
function shareSizeToken(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (SIZE_RE.test(x) && b.has(x)) return true;
  return false;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  private async resolveAccount(organizationId: string, marketplaceAccountId: string) {
    const acc = await this.prisma.marketplaceAccount.findFirst({
      where: { id: marketplaceAccountId, organizationId },
    });
    if (!acc) throw new NotFoundException('Loja não encontrada nesta organização.');
    return acc;
  }

  // ===========================================================================
  // Importação do catálogo de produtos (prompt §3–§17). Passo único, idempotente:
  // sincroniza anúncios e variações sem duplicar e sem destruir dados internos.
  // ===========================================================================
  async importCatalog(
    organizationId: string,
    actorId: string,
    marketplaceAccountId: string,
    file: UploadedFile | undefined,
  ): Promise<ProductImportSummary> {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    await this.resolveAccount(organizationId, marketplaceAccountId);

    const parsed = parseProductSheet(file.buffer, file.originalname);
    if (parsed.notRecognized) {
      throw new BadRequestException(
        'Não foi possível localizar o cabeçalho da planilha de produtos da Shopee (colunas "ID do Produto" e "Nome do Produto").',
      );
    }

    const alreadyImported =
      (await this.prisma.productImportBatch.count({
        where: {
          marketplaceAccountId,
          fileHash: parsed.fileHash,
          status: { in: [DbBatchStatus.COMPLETED, DbBatchStatus.COMPLETED_WITH_ERRORS] },
        },
      })) > 0;

    const storageKey = this.storage.buildKey(
      organizationId,
      marketplaceAccountId,
      parsed.fileHash,
      parsed.declaredExtension || parsed.format.toLowerCase(),
    );
    await this.storage.save(storageKey, file.buffer);

    const startedAt = new Date();
    const batch = await this.prisma.productImportBatch.create({
      data: {
        organizationId,
        marketplaceAccountId,
        ingestionSource: DbIngestionSource.MANUAL_UPLOAD,
        originalFilename: file.originalname,
        sanitizedFilename: sanitizeFilename(file.originalname),
        declaredExtension: parsed.declaredExtension,
        fileFormat: parsed.format,
        fileSizeBytes: parsed.fileSizeBytes,
        fileHash: parsed.fileHash,
        storageKey,
        sheetName: parsed.sheetName,
        headerRowIndex: parsed.headerRowIndex,
        dataStartRowIndex: parsed.dataStartRowIndex,
        columnCount: parsed.columns.length,
        physicalRowCount: parsed.physicalRowCount,
        dataRowCount: parsed.rows.length,
        status: DbBatchStatus.PROCESSING,
        createdByUserId: actorId,
        startedAt,
      },
    });

    const start = Date.now();
    let result: Awaited<ReturnType<typeof this.syncCatalog>>;
    try {
      result = await this.syncCatalog(organizationId, marketplaceAccountId, batch.id, parsed);
    } catch (e) {
      await this.prisma.productImportBatch.update({
        where: { id: batch.id },
        data: {
          status: DbBatchStatus.FAILED,
          errorMessage: e instanceof Error ? e.message : 'Falha ao processar a planilha.',
          completedAt: new Date(),
          processingMs: Date.now() - start,
        },
      });
      throw e;
    }

    const status =
      result.errorRows > 0 ? DbBatchStatus.COMPLETED_WITH_ERRORS : DbBatchStatus.COMPLETED;
    const processingMs = Date.now() - start;

    await this.prisma.productImportBatch.update({
      where: { id: batch.id },
      data: {
        status,
        totalRows: parsed.rows.length,
        productsSeen: result.productsSeen,
        variationsSeen: result.variationsSeen,
        newProducts: result.newProducts,
        newVariations: result.newVariations,
        updatedRecords: result.updatedRecords,
        unchangedRecords: result.unchangedRecords,
        ignoredRows: parsed.ignoredRows,
        errorRows: result.errorRows,
        errors: result.errors.length ? (result.errors as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        processingMs,
        completedAt: new Date(),
      },
    });

    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.PRODUCT_IMPORT,
      entityType: 'ProductImportBatch',
      entityId: batch.id,
      metadata: {
        filename: file.originalname,
        productsSeen: result.productsSeen,
        variationsSeen: result.variationsSeen,
        newProducts: result.newProducts,
        newVariations: result.newVariations,
        updatedRecords: result.updatedRecords,
        errorRows: result.errorRows,
        processingMs,
      },
    });

    return {
      batchId: batch.id,
      status: status as unknown as ProductImportSummary['status'],
      fileFormat: parsed.format,
      headerRowIndex: parsed.headerRowIndex,
      dataStartRowIndex: parsed.dataStartRowIndex,
      columnCount: parsed.columns.length,
      physicalRowCount: parsed.physicalRowCount,
      totalRows: parsed.rows.length,
      productsSeen: result.productsSeen,
      variationsSeen: result.variationsSeen,
      newProducts: result.newProducts,
      newVariations: result.newVariations,
      updatedRecords: result.updatedRecords,
      unchangedRecords: result.unchangedRecords,
      ignoredRows: parsed.ignoredRows,
      errorRows: result.errorRows,
      errors: result.errors,
      alreadyImported,
    };
  }

  /**
   * Núcleo da sincronização. Upsert de anúncios e variações preservando os campos
   * internos (família, preço de fechamento, notas). Ver prompt §15.
   */
  private async syncCatalog(
    organizationId: string,
    marketplaceAccountId: string,
    batchId: string,
    parsed: ParsedProductSheet,
  ) {
    const now = new Date();
    const errors: ProductImportError[] = [];
    const valid: ProductRowData[] = [];
    for (const r of parsed.rows) {
      if (r.error) {
        errors.push({
          physicalRow: r.physicalRowNumber,
          shopeeProductId: r.shopeeProductId,
          sku: r.sku,
          message: r.error,
        });
      } else {
        valid.push(r);
      }
    }

    // Nome do anúncio por ID do Produto (primeira ocorrência não vazia vence).
    const productIds = new Set<string>();
    const nameByShopeeId = new Map<string, string>();
    for (const r of valid) {
      const sid = r.shopeeProductId!;
      productIds.add(sid);
      if (!nameByShopeeId.has(sid) && r.productName) nameByShopeeId.set(sid, r.productName);
    }

    // --- Anúncios: cria os novos, atualiza nome quando mudou ---
    const existingProducts = await this.prisma.product.findMany({
      where: { marketplaceAccountId, shopeeProductId: { in: [...productIds] } },
      select: { id: true, shopeeProductId: true, name: true },
    });
    const existingByShopee = new Map(existingProducts.map((p) => [p.shopeeProductId, p]));

    const productCreates: Prisma.ProductCreateManyInput[] = [];
    const productNameUpdates: Array<{ id: string; name: string }> = [];
    for (const sid of productIds) {
      const name = nameByShopeeId.get(sid) ?? sid;
      const existing = existingByShopee.get(sid);
      if (!existing) {
        productCreates.push({
          organizationId,
          marketplaceAccountId,
          shopeeProductId: sid,
          name,
          firstImportBatchId: batchId,
          lastImportBatchId: batchId,
          firstSeenAt: now,
          lastSeenAt: now,
        });
      } else if (existing.name !== name) {
        productNameUpdates.push({ id: existing.id, name });
      }
    }

    if (productCreates.length) {
      await this.prisma.product.createMany({ data: productCreates, skipDuplicates: true });
    }

    // Mapa completo (id) após criar os novos.
    const allProducts = await this.prisma.product.findMany({
      where: { marketplaceAccountId, shopeeProductId: { in: [...productIds] } },
      select: { id: true, shopeeProductId: true },
    });
    const productDbIdByShopee = new Map(allProducts.map((p) => [p.shopeeProductId, p.id]));
    const productDbIds = allProducts.map((p) => p.id);

    // --- Variações: dedup dentro do arquivo (última linha da mesma chave vence) ---
    const lastRowByKey = new Map<string, { row: ProductRowData; productDbId: string }>();
    for (const r of valid) {
      const productDbId = productDbIdByShopee.get(r.shopeeProductId!);
      if (!productDbId) continue;
      lastRowByKey.set(`${productDbId}|${r.variationKey}`, { row: r, productDbId });
    }

    const existingVars = await this.prisma.productVariation.findMany({
      where: { productId: { in: productDbIds } },
      select: {
        id: true,
        productId: true,
        variationKey: true,
        variationName: true,
        sku: true,
        referenceSku: true,
        gtin: true,
        shopeeFullPrice: true,
        sellerStock: true,
        failReason: true,
      },
    });
    const existingVarByKey = new Map(existingVars.map((v) => [`${v.productId}|${v.variationKey}`, v]));

    const varCreates: Prisma.ProductVariationCreateManyInput[] = [];
    const varUpdates: Array<{ id: string; data: Prisma.ProductVariationUpdateManyMutationInput }> = [];
    const unchangedIds: string[] = [];
    let newVariations = 0;
    let updatedRecords = 0;
    let unchangedRecords = 0;

    for (const { row, productDbId } of lastRowByKey.values()) {
      const key = `${productDbId}|${row.variationKey}`;
      const existing = existingVarByKey.get(key);
      if (!existing) {
        varCreates.push({
          organizationId,
          marketplaceAccountId,
          productId: productDbId,
          shopeeVariationId: row.shopeeVariationId ?? '',
          variationKey: row.variationKey,
          variationName: row.variationName,
          sku: row.sku,
          referenceSku: row.referenceSku,
          gtin: row.gtin,
          shopeeFullPrice: row.shopeeFullPrice,
          sellerStock: row.sellerStock,
          failReason: row.failReason,
          firstImportBatchId: batchId,
          lastImportBatchId: batchId,
          firstSeenAt: now,
          lastSeenAt: now,
        });
        newVariations++;
      } else {
        const changed =
          (existing.variationName ?? null) !== (row.variationName ?? null) ||
          (existing.sku ?? null) !== (row.sku ?? null) ||
          (existing.referenceSku ?? null) !== (row.referenceSku ?? null) ||
          (existing.gtin ?? null) !== (row.gtin ?? null) ||
          (existing.sellerStock ?? null) !== (row.sellerStock ?? null) ||
          (existing.failReason ?? null) !== (row.failReason ?? null) ||
          decChanged(existing.shopeeFullPrice, row.shopeeFullPrice);
        if (changed) {
          // Atualiza SOMENTE os campos importados da Shopee — nunca família/preço
          // de fechamento/notas internas (prompt §15).
          varUpdates.push({
            id: existing.id,
            data: {
              variationName: row.variationName,
              sku: row.sku,
              referenceSku: row.referenceSku,
              gtin: row.gtin,
              shopeeFullPrice: row.shopeeFullPrice,
              sellerStock: row.sellerStock,
              failReason: row.failReason,
              shopeeVariationId: row.shopeeVariationId ?? existing.variationKey,
              lastImportBatchId: batchId,
              lastSeenAt: now,
            },
          });
          updatedRecords++;
        } else {
          unchangedIds.push(existing.id);
          unchangedRecords++;
        }
      }
    }

    // Alterações de nome do anúncio contam como registros atualizados.
    updatedRecords += productNameUpdates.length;

    // --- Persistência ---
    await this.prisma.$transaction(
      async (tx) => {
        for (const c of chunk(varCreates)) {
          await tx.productVariation.createMany({ data: c, skipDuplicates: true });
        }
        for (const u of varUpdates) {
          await tx.productVariation.update({ where: { id: u.id }, data: u.data });
        }
        for (const p of productNameUpdates) {
          await tx.product.update({
            where: { id: p.id },
            data: { name: p.name, lastImportBatchId: batchId, lastSeenAt: now },
          });
        }
        // Anúncios existentes tocados nesta importação: atualiza lastSeen.
        const touchedProductIds = allProducts
          .filter((p) => existingByShopee.has(p.shopeeProductId))
          .map((p) => p.id);
        for (const c of chunk(touchedProductIds)) {
          await tx.product.updateMany({
            where: { id: { in: c } },
            data: { lastImportBatchId: batchId, lastSeenAt: now },
          });
        }
        // Variações inalteradas: apenas marca presença (lastSeen) sem contar update.
        for (const c of chunk(unchangedIds)) {
          await tx.productVariation.updateMany({
            where: { id: { in: c } },
            data: { lastImportBatchId: batchId, lastSeenAt: now },
          });
        }
        // Recalcula os agregados de TODOS os anúncios tocados (contagem, estoque,
        // faixa de preço, SKUs sem família/sem preço de fechamento).
        await this.recomputeAggregates(allProducts.map((p) => p.id), tx);
      },
      { timeout: 120000 },
    );

    return {
      productsSeen: productIds.size,
      variationsSeen: lastRowByKey.size,
      newProducts: productCreates.length,
      newVariations,
      updatedRecords,
      unchangedRecords,
      errorRows: errors.length,
      errors,
    };
  }

  /**
   * Recalcula os agregados denormalizados de um conjunto de anúncios em UM único
   * UPDATE (eficiente mesmo com milhares de anúncios). Chamado na importação e
   * em qualquer operação que altere família/preço de fechamento de variações.
   */
  private async recomputeAggregates(ids: string[], client: Db = this.prisma) {
    if (!ids.length) return;
    for (const c of chunk(ids, 2000)) {
      await client.$executeRaw(Prisma.sql`
        UPDATE "products" p SET
          "variationCount" = agg.cnt,
          "totalStock" = agg.stock,
          "minPrice" = agg.minp,
          "maxPrice" = agg.maxp,
          "variationsWithoutFamily" = agg.nofam,
          "variationsWithoutClosingPrice" = agg.noclose,
          "updatedAt" = now()
        FROM (
          SELECT "productId",
            count(*)::int AS cnt,
            coalesce(sum("sellerStock"), 0)::int AS stock,
            min("shopeeFullPrice") AS minp,
            max("shopeeFullPrice") AS maxp,
            count(*) FILTER (WHERE "familyId" IS NULL)::int AS nofam,
            count(*) FILTER (WHERE "closingPrice" IS NULL)::int AS noclose
          FROM "product_variations"
          WHERE "productId" IN (${Prisma.join(c)})
          GROUP BY "productId"
        ) agg
        WHERE p."id" = agg."productId";
      `);
    }
  }

  private async productIdsOfVariations(variationIds: string[]): Promise<string[]> {
    if (!variationIds.length) return [];
    const rows = await this.prisma.productVariation.findMany({
      where: { id: { in: variationIds } },
      select: { productId: true },
      distinct: ['productId'],
    });
    return rows.map((r) => r.productId);
  }

  // ===========================================================================
  // Leitura de produtos (listagem por anúncio com variações expansíveis)
  // ===========================================================================

  /** Monta os filtros de produto e de variação a partir dos parâmetros da tela. */
  private buildProductWhere(
    organizationId: string,
    marketplaceAccountId: string | undefined,
    filters: ProductFilters,
  ) {
    const and: Prisma.ProductWhereInput[] = [];
    const search = filters.search?.trim();
    if (search) {
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { shopeeProductId: { contains: search } },
          {
            variations: {
              some: {
                OR: [
                  { sku: { contains: search, mode: 'insensitive' } },
                  { variationName: { contains: search, mode: 'insensitive' } },
                  { shopeeVariationId: { contains: search } },
                ],
              },
            },
          },
        ],
      });
    }
    if (filters.familyId) and.push({ variations: { some: { familyId: filters.familyId } } });
    if (filters.family === 'with') and.push({ variations: { some: { familyId: { not: null } } } });
    if (filters.family === 'without') and.push({ variations: { some: { familyId: null } } });
    if (filters.closingPrice === 'with') and.push({ variations: { some: { closingPrice: { not: null } } } });
    if (filters.closingPrice === 'without') and.push({ variations: { some: { closingPrice: null } } });
    if (filters.stock === 'with') and.push({ variations: { some: { sellerStock: { gt: 0 } } } });
    if (filters.stock === 'zero') and.push({ variations: { some: { sellerStock: 0 } } });
    if (filters.stock === 'without') and.push({ NOT: { variations: { some: { sellerStock: { gt: 0 } } } } });
    if (filters.variations === 'single') and.push({ variationCount: 1 });
    if (filters.variations === 'multiple') and.push({ variationCount: { gt: 1 } });
    if (filters.status) and.push({ status: filters.status as DbEntityStatus });

    const where: Prisma.ProductWhereInput = { organizationId };
    if (marketplaceAccountId) where.marketplaceAccountId = marketplaceAccountId;
    if (and.length) where.AND = and;
    return where;
  }

  private orderByFor(sort: ProductSort | undefined): Prisma.ProductOrderByWithRelationInput[] {
    const nulls = 'last' as const;
    switch (sort) {
      case 'name_desc':
        return [{ name: 'desc' }];
      case 'stock_desc':
        return [{ totalStock: 'desc' }, { name: 'asc' }];
      case 'stock_asc':
        return [{ totalStock: 'asc' }, { name: 'asc' }];
      case 'price_desc':
        return [{ maxPrice: { sort: 'desc', nulls } }, { name: 'asc' }];
      case 'price_asc':
        return [{ minPrice: { sort: 'asc', nulls } }, { name: 'asc' }];
      case 'variations_desc':
        return [{ variationCount: 'desc' }, { name: 'asc' }];
      case 'variations_asc':
        return [{ variationCount: 'asc' }, { name: 'asc' }];
      case 'without_family':
        return [{ variationsWithoutFamily: 'desc' }, { name: 'asc' }];
      case 'without_closing':
        return [{ variationsWithoutClosingPrice: 'desc' }, { name: 'asc' }];
      default:
        return [{ name: 'asc' }];
    }
  }

  async listProducts(organizationId: string, marketplaceAccountId: string | undefined, filters: ProductFilters) {
    const pageSize = [25, 50, 100].includes(filters.pageSize ?? 0) ? filters.pageSize! : 25;
    const page = Math.max(1, filters.page ?? 1);
    const search = filters.search?.trim()?.toLowerCase();
    const where = this.buildProductWhere(organizationId, marketplaceAccountId, filters);

    const [total, matchedVariations, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.productVariation.count({ where: { product: { is: where } } }),
      this.prisma.product.findMany({
        where,
        orderBy: this.orderByFor(filters.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          variations: {
            orderBy: [{ variationName: 'asc' }, { sku: 'asc' }],
            include: {
              family: {
                select: { id: true, name: true, currentCostAmount: true, currentCostEffectiveFrom: true, status: true },
              },
            },
          },
        },
      }),
    ]);

    const matchVar = (v: { sku: string | null; variationName: string | null; shopeeVariationId: string | null }) =>
      !!search &&
      ((v.sku ?? '').toLowerCase().includes(search) ||
        (v.variationName ?? '').toLowerCase().includes(search) ||
        (v.shopeeVariationId ?? '').toLowerCase().includes(search));

    const items = products.map((p) => {
      const families = new Set(p.variations.map((v) => v.familyId).filter(Boolean) as string[]);
      const familySummary =
        families.size === 0 ? 'none' : p.variations.every((v) => v.familyId) && families.size === 1 ? 'single' : 'multiple';
      const nameMatches = !!search && (p.name.toLowerCase().includes(search) || p.shopeeProductId.includes(search));
      const anyVarMatch = p.variations.some(matchVar);
      return {
        id: p.id,
        shopeeProductId: p.shopeeProductId,
        name: p.name,
        status: p.status,
        variationCount: p.variationCount,
        totalStock: p.totalStock,
        priceMin: p.minPrice != null ? p.minPrice.toString() : null,
        priceMax: p.maxPrice != null ? p.maxPrice.toString() : null,
        variationsWithoutFamily: p.variationsWithoutFamily,
        variationsWithoutClosingPrice: p.variationsWithoutClosingPrice,
        familySummary,
        // Abre o master automaticamente quando o casamento veio de uma variação.
        autoExpand: !!search && anyVarMatch && !nameMatches,
        lastSeenAt: p.lastSeenAt,
        variations: p.variations.map((v) => ({
          id: v.id,
          shopeeVariationId: v.shopeeVariationId,
          variationName: v.variationName,
          sku: v.sku,
          referenceSku: v.referenceSku,
          gtin: v.gtin,
          shopeeFullPrice: v.shopeeFullPrice,
          closingPrice: v.closingPrice,
          sellerStock: v.sellerStock,
          failReason: v.failReason,
          familyId: v.familyId,
          family: v.family,
          matched: matchVar(v),
        })),
      };
    });

    return { total, matchedVariations, page, pageSize, items };
  }

  /**
   * IDs de TODAS as variações que casam com o filtro atual (todas as páginas) —
   * base do "selecionar todos os N resultados". Limitado por segurança.
   */
  async variationIdsForFilter(
    organizationId: string,
    marketplaceAccountId: string | undefined,
    filters: ProductFilters,
  ): Promise<{ variationIds: string[]; truncated: boolean }> {
    const where = this.buildProductWhere(organizationId, marketplaceAccountId, filters);
    const LIMIT = 20000;
    const rows = await this.prisma.productVariation.findMany({
      where: { product: { is: where } },
      select: { id: true },
      take: LIMIT + 1,
    });
    return { variationIds: rows.slice(0, LIMIT).map((r) => r.id), truncated: rows.length > LIMIT };
  }

  async productStats(organizationId: string, marketplaceAccountId?: string) {
    const accScope = marketplaceAccountId ? { marketplaceAccountId } : {};
    const [products, variations, withoutFamily, withoutClosing, families] = await this.prisma.$transaction([
      this.prisma.product.count({ where: { organizationId, ...accScope } }),
      this.prisma.productVariation.count({ where: { organizationId, ...accScope } }),
      this.prisma.productVariation.count({ where: { organizationId, ...accScope, familyId: null } }),
      this.prisma.productVariation.count({ where: { organizationId, ...accScope, closingPrice: null } }),
      this.prisma.productFamily.count({ where: { organizationId, ...accScope } }),
    ]);
    return {
      products,
      variations,
      variationsWithoutFamily: withoutFamily,
      variationsWithoutClosingPrice: withoutClosing,
      families,
    };
  }

  // ===========================================================================
  // Famílias (unidade de custo, com histórico)
  // ===========================================================================
  async listFamilies(organizationId: string, marketplaceAccountId?: string, search?: string) {
    const where: Prisma.ProductFamilyWhereInput = { organizationId };
    if (marketplaceAccountId) where.marketplaceAccountId = marketplaceAccountId;
    if (search) where.name = { contains: search.trim(), mode: 'insensitive' };
    const families = await this.prisma.productFamily.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { variations: true } } },
    });
    return families.map((f) => ({
      id: f.id,
      name: f.name,
      internalCode: f.internalCode,
      notes: f.notes,
      status: f.status,
      currentCostAmount: f.currentCostAmount,
      currentCostEffectiveFrom: f.currentCostEffectiveFrom,
      costUpdatedAt: f.costUpdatedAt,
      variationCount: f._count.variations,
    }));
  }

  async getFamily(organizationId: string, id: string) {
    const family = await this.prisma.productFamily.findFirst({
      where: { id, organizationId },
      include: {
        costHistory: { orderBy: { effectiveFrom: 'desc' } },
        _count: { select: { variations: true } },
      },
    });
    if (!family) throw new NotFoundException('Família não encontrada.');
    return family;
  }

  async createFamily(organizationId: string, actorId: string, dto: CreateFamilyDto) {
    await this.resolveAccount(organizationId, dto.marketplaceAccountId);
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Informe o nome da família.');
    const normalizedName = normalizeLabel(name);

    const clash = await this.prisma.productFamily.findFirst({
      where: { marketplaceAccountId: dto.marketplaceAccountId, normalizedName },
    });
    if (clash) throw new ConflictException('Já existe uma família com esse nome nesta loja.');

    const cost = this.parseCost(dto.cost);
    const effectiveFrom = this.parseEffectiveFrom(dto.costEffectiveFrom);

    const family = await this.prisma.productFamily.create({
      data: {
        organizationId,
        marketplaceAccountId: dto.marketplaceAccountId,
        name,
        normalizedName,
        internalCode: dto.internalCode?.trim() || null,
        notes: dto.notes?.trim() || null,
        status: (dto.status as DbEntityStatus) ?? DbEntityStatus.ACTIVE,
        currentCostAmount: cost ?? null,
        currentCostEffectiveFrom: cost ? effectiveFrom : null,
        costUpdatedAt: cost ? new Date() : null,
        createdByUserId: actorId,
        ...(cost
          ? {
              costHistory: {
                create: { costAmount: cost, effectiveFrom, createdByUserId: actorId },
              },
            }
          : {}),
      },
    });

    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.PRODUCT_FAMILY_CREATE,
      entityType: 'ProductFamily',
      entityId: family.id,
      after: { name, cost: cost?.toString() ?? null },
    });
    return family;
  }

  async updateFamily(organizationId: string, actorId: string, id: string, dto: UpdateFamilyDto) {
    const family = await this.prisma.productFamily.findFirst({ where: { id, organizationId } });
    if (!family) throw new NotFoundException('Família não encontrada.');

    const data: Prisma.ProductFamilyUpdateInput = {};
    if (dto.name != null) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('O nome da família não pode ficar vazio.');
      const normalizedName = normalizeLabel(name);
      if (normalizedName !== family.normalizedName) {
        const clash = await this.prisma.productFamily.findFirst({
          where: { marketplaceAccountId: family.marketplaceAccountId, normalizedName, id: { not: id } },
        });
        if (clash) throw new ConflictException('Já existe uma família com esse nome nesta loja.');
      }
      data.name = name;
      data.normalizedName = normalizedName;
    }
    if (dto.internalCode !== undefined) data.internalCode = dto.internalCode?.trim() || null;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.status !== undefined) data.status = dto.status as DbEntityStatus;

    // Custo: só gera histórico quando o valor muda (prompt §9).
    let costAppended = false;
    if (dto.cost !== undefined && dto.cost !== '') {
      const cost = this.parseCost(dto.cost);
      if (cost == null) throw new BadRequestException('Custo inválido.');
      const effectiveFrom = this.parseEffectiveFrom(dto.costEffectiveFrom);
      const isDifferent =
        family.currentCostAmount == null || !family.currentCostAmount.equals(cost);
      if (isDifferent) {
        data.currentCostAmount = cost;
        data.currentCostEffectiveFrom = effectiveFrom;
        data.costUpdatedAt = new Date();
        data.costHistory = { create: { costAmount: cost, effectiveFrom, createdByUserId: actorId } };
        costAppended = true;
      }
    }

    const updated = await this.prisma.productFamily.update({ where: { id }, data });
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.PRODUCT_FAMILY_UPDATE,
      entityType: 'ProductFamily',
      entityId: id,
      before: {
        name: family.name,
        cost: family.currentCostAmount?.toString() ?? null,
      },
      after: {
        name: updated.name,
        cost: updated.currentCostAmount?.toString() ?? null,
        costAppended,
      },
    });
    return updated;
  }

  private parseCost(cost?: string): Prisma.Decimal | null {
    if (cost == null || cost.trim() === '') return null;
    const p = parseDecimal(cost);
    if (p.decimal == null) throw new BadRequestException(`Custo inválido: "${cost}".`);
    return new Prisma.Decimal(p.decimal);
  }

  private parseEffectiveFrom(value?: string): Date {
    if (!value) return new Date();
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new BadRequestException('Data de vigência do custo inválida.');
    return d;
  }

  // ===========================================================================
  // Classificação em massa e edição de variação (dados internos)
  // ===========================================================================
  async classifyVariations(organizationId: string, actorId: string, dto: ClassifyVariationsDto) {
    if (!dto.variationIds.length) throw new BadRequestException('Selecione ao menos uma variação.');

    let familyId: string | null = null;
    if (dto.familyId) {
      const family = await this.prisma.productFamily.findFirst({
        where: { id: dto.familyId, organizationId },
        select: { id: true },
      });
      if (!family) throw new NotFoundException('Família não encontrada.');
      familyId = family.id;
    }

    // Restringe às variações da própria organização (isolamento).
    const owned = await this.prisma.productVariation.findMany({
      where: { id: { in: dto.variationIds }, organizationId },
      select: { id: true },
    });
    const ownedIds = owned.map((v) => v.id);
    if (!ownedIds.length) throw new NotFoundException('Nenhuma variação válida selecionada.');

    const res = await this.prisma.productVariation.updateMany({
      where: { id: { in: ownedIds } },
      data: { familyId },
    });
    await this.recomputeAggregates(await this.productIdsOfVariations(ownedIds));

    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.PRODUCT_CLASSIFY,
      entityType: 'ProductVariation',
      metadata: { count: res.count, familyId },
    });
    return { updated: res.count, familyId };
  }

  /**
   * Ação em massa: aplica família, preço de fechamento e/ou status (no anúncio
   * pai) a um conjunto de variações selecionadas. Só os campos informados mudam.
   */
  async bulkUpdate(
    organizationId: string,
    actorId: string,
    dto: {
      variationIds: string[];
      familyId?: string | null;
      closingPrice?: string | null;
      status?: 'ACTIVE' | 'INACTIVE';
    },
  ) {
    if (!dto.variationIds?.length) throw new BadRequestException('Selecione ao menos uma variação.');
    const owned = await this.prisma.productVariation.findMany({
      where: { id: { in: dto.variationIds }, organizationId },
      select: { id: true, productId: true },
    });
    const ownedIds = owned.map((v) => v.id);
    if (!ownedIds.length) throw new NotFoundException('Nenhuma variação válida selecionada.');

    const varData: Prisma.ProductVariationUncheckedUpdateManyInput = {};
    if (dto.familyId !== undefined) {
      if (dto.familyId === null) varData.familyId = null;
      else {
        const family = await this.prisma.productFamily.findFirst({
          where: { id: dto.familyId, organizationId },
          select: { id: true },
        });
        if (!family) throw new NotFoundException('Família não encontrada.');
        varData.familyId = family.id;
      }
    }
    if (dto.closingPrice !== undefined) {
      if (dto.closingPrice === null || dto.closingPrice === '') varData.closingPrice = null;
      else {
        const p = parseDecimal(dto.closingPrice);
        if (p.decimal == null) throw new BadRequestException('Preço de fechamento inválido.');
        varData.closingPrice = new Prisma.Decimal(p.decimal);
      }
    }

    let updated = 0;
    if (Object.keys(varData).length) {
      const res = await this.prisma.productVariation.updateMany({ where: { id: { in: ownedIds } }, data: varData });
      updated = res.count;
    }
    // Status é aplicado no ANÚNCIO pai das variações selecionadas (prompt §5/§14/§38).
    if (dto.status) {
      const productIds = [...new Set(owned.map((v) => v.productId))];
      await this.prisma.product.updateMany({
        where: { id: { in: productIds }, organizationId },
        data: { status: dto.status as DbEntityStatus },
      });
    }
    await this.recomputeAggregates(await this.productIdsOfVariations(ownedIds));

    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.PRODUCT_CLASSIFY,
      entityType: 'ProductVariation',
      metadata: { count: ownedIds.length, ...dto, variationIds: undefined },
    });
    return { updated: ownedIds.length, fieldsUpdated: updated };
  }

  async updateVariation(organizationId: string, actorId: string, id: string, dto: UpdateVariationDto) {
    const variation = await this.prisma.productVariation.findFirst({
      where: { id, organizationId },
    });
    if (!variation) throw new NotFoundException('Variação não encontrada.');

    const data: Prisma.ProductVariationUpdateInput = {};
    if (dto.closingPrice !== undefined) {
      if (dto.closingPrice === null) data.closingPrice = null;
      else {
        const p = parseDecimal(dto.closingPrice);
        if (p.decimal == null) throw new BadRequestException('Preço de fechamento inválido.');
        data.closingPrice = new Prisma.Decimal(p.decimal);
      }
    }
    if (dto.internalNotes !== undefined) data.internalNotes = dto.internalNotes?.trim() || null;
    if (dto.familyId !== undefined) {
      if (dto.familyId === null) {
        data.family = { disconnect: true };
      } else {
        const family = await this.prisma.productFamily.findFirst({
          where: { id: dto.familyId, organizationId },
          select: { id: true },
        });
        if (!family) throw new NotFoundException('Família não encontrada.');
        data.family = { connect: { id: family.id } };
      }
    }

    const updated = await this.prisma.productVariation.update({ where: { id }, data });
    await this.recomputeAggregates([updated.productId]);
    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.PRODUCT_VARIATION_UPDATE,
      entityType: 'ProductVariation',
      entityId: id,
      after: {
        closingPrice: updated.closingPrice?.toString() ?? null,
        familyId: updated.familyId,
      },
    });
    return updated;
  }

  // ===========================================================================
  // Sugestão de família (prompt §35–§37).
  //
  // Implementação DETERMINÍSTICA (heurística de similaridade de tokens) — já é
  // útil e nunca altera nada sozinha (só sugere). A arquitetura está pronta para
  // trocar a heurística por uma chamada de LLM sem mudar o contrato: recebe as
  // variações e as famílias existentes, devolve {variationId, familyId, confiança}.
  // Custo NUNCA é inferido aqui (§36); vem sempre da família cadastrada.
  // ===========================================================================
  async suggestFamilies(organizationId: string, marketplaceAccountId: string, variationIds: string[]) {
    if (!variationIds.length) return { suggestions: [], engine: 'heuristic' as const };
    const [variations, families] = await Promise.all([
      this.prisma.productVariation.findMany({
        where: { id: { in: variationIds }, organizationId },
        select: { id: true, variationName: true, sku: true, product: { select: { name: true } } },
      }),
      this.prisma.productFamily.findMany({
        where: { organizationId, marketplaceAccountId, status: DbEntityStatus.ACTIVE },
        select: { id: true, name: true, currentCostAmount: true },
      }),
    ]);

    const famTokens = families.map((f) => ({ ...f, tokens: tokenize(f.name) }));
    const suggestions = variations.map((v) => {
      const vtok = tokenize(`${v.product?.name ?? ''} ${v.variationName ?? ''} ${v.sku ?? ''}`);
      let best: { familyId: string; familyName: string; cost: string | null; confidence: number } | null = null;
      for (const f of famTokens) {
        if (!f.tokens.size) continue;
        const overlap = intersectionSize(vtok, f.tokens);
        if (overlap === 0) continue;
        // Jaccard ponderado + bônus para casar padrões de tamanho (40x60, 3x2, …).
        const jaccard = overlap / unionSize(vtok, f.tokens);
        const sizeBonus = shareSizeToken(vtok, f.tokens) ? 0.25 : 0;
        const confidence = Math.min(1, jaccard + sizeBonus);
        if (!best || confidence > best.confidence) {
          best = { familyId: f.id, familyName: f.name, cost: f.currentCostAmount?.toString() ?? null, confidence };
        }
      }
      const confident = best && best.confidence >= 0.34 ? best : null;
      return {
        variationId: v.id,
        sku: v.sku,
        productName: v.product?.name ?? null,
        variationName: v.variationName,
        suggestion: confident
          ? {
              familyId: confident.familyId,
              familyName: confident.familyName,
              cost: confident.cost,
              confidence: Math.round(confident.confidence * 100),
            }
          : null,
      };
    });
    return { suggestions, engine: 'heuristic' as const };
  }

  // ===========================================================================
  // Histórico de importações de produtos (prompt §18)
  // ===========================================================================
  listImportBatches(organizationId: string, marketplaceAccountId?: string) {
    return this.prisma.productImportBatch.findMany({
      where: { organizationId, ...(marketplaceAccountId ? { marketplaceAccountId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        marketplaceAccount: { select: { displayName: true } },
        createdBy: { select: { name: true } },
      },
    });
  }

  /**
   * Resolve o custo vigente da família de uma variação em uma data (SKU → variação
   * → família → custo vigente). Base para o cálculo de lucro por pedido nos próximos
   * blocos (prompt §22, §23).
   */
  async resolveVariationCost(organizationId: string, variationId: string, at?: Date) {
    const variation = await this.prisma.productVariation.findFirst({
      where: { id: variationId, organizationId },
      select: { familyId: true, family: { select: { id: true, name: true } } },
    });
    if (!variation) throw new NotFoundException('Variação não encontrada.');
    if (!variation.familyId || !variation.family) return null;
    const reference = at ?? new Date();
    const entry = await this.prisma.productFamilyCostHistory.findFirst({
      where: { familyId: variation.familyId, effectiveFrom: { lte: reference } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return {
      familyId: variation.family.id,
      familyName: variation.family.name,
      costAmount: entry?.costAmount?.toString() ?? null,
      effectiveFrom: entry?.effectiveFrom?.toISOString() ?? null,
    };
  }
}
