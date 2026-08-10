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

interface ProductFilters {
  search?: string;
  familyId?: string;
  family?: 'with' | 'without';
  closingPrice?: 'with' | 'without';
  page?: number;
}

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

  // ===========================================================================
  // Leitura de produtos (listagem por anúncio com variações expansíveis)
  // ===========================================================================
  async listProducts(organizationId: string, marketplaceAccountId: string | undefined, filters: ProductFilters) {
    const pageSize = 25;
    const page = Math.max(1, filters.page ?? 1);

    // Filtros ao nível de variação (família / preço de fechamento).
    const variationWhere: Prisma.ProductVariationWhereInput = {};
    if (filters.familyId) variationWhere.familyId = filters.familyId;
    if (filters.family === 'with') variationWhere.familyId = { not: null };
    if (filters.family === 'without') variationWhere.familyId = null;
    if (filters.closingPrice === 'with') variationWhere.closingPrice = { not: null };
    if (filters.closingPrice === 'without') variationWhere.closingPrice = null;
    const hasVariationFilter = Object.keys(variationWhere).length > 0;

    const where: Prisma.ProductWhereInput = { organizationId };
    if (marketplaceAccountId) where.marketplaceAccountId = marketplaceAccountId;
    if (filters.search) {
      const s = filters.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { shopeeProductId: { contains: s } },
        { variations: { some: { sku: { contains: s, mode: 'insensitive' } } } },
      ];
    }
    if (hasVariationFilter) {
      where.variations = { some: variationWhere };
    }

    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          variations: {
            orderBy: [{ variationName: 'asc' }, { sku: 'asc' }],
            include: {
              family: {
                select: { id: true, name: true, currentCostAmount: true, status: true },
              },
            },
          },
        },
      }),
    ]);

    const items = products.map((p) => {
      const prices = p.variations
        .map((v) => (v.shopeeFullPrice != null ? Number(v.shopeeFullPrice) : null))
        .filter((n): n is number => n != null);
      return {
        id: p.id,
        shopeeProductId: p.shopeeProductId,
        name: p.name,
        status: p.status,
        variationCount: p.variations.length,
        priceMin: prices.length ? Math.min(...prices).toFixed(2) : null,
        priceMax: prices.length ? Math.max(...prices).toFixed(2) : null,
        variationsWithoutFamily: p.variations.filter((v) => !v.familyId).length,
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
        })),
      };
    });

    return { total, page, pageSize, items };
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

    await this.audit.record({
      organizationId,
      userId: actorId,
      action: AuditAction.PRODUCT_CLASSIFY,
      entityType: 'ProductVariation',
      metadata: { count: res.count, familyId },
    });
    return { updated: res.count, familyId };
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
