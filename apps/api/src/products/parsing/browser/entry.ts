/**
 * Ponto de entrada do bundle de navegador da homologação de PRODUTOS.
 * Expõe o parser REAL da planilha de produtos (o mesmo do servidor) e uma
 * simulação fiel da sincronização (upsert) em memória — para provar, localmente,
 * o agrupamento por anúncio, a reimportação sem duplicar e a preservação dos
 * dados internos. Processamento 100% local; nada é enviado para fora.
 */
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { parseProductSheet, ProductRowData } from '../product-sheet';

interface SimVariation {
  shopeeVariationId: string | null;
  variationName: string | null;
  sku: string | null;
  referenceSku: string | null;
  gtin: string | null;
  shopeeFullPrice: string | null;
  sellerStock: number | null;
  failReason: string | null;
  // Campos internos — nunca sobrescritos por reimportação (simulados).
  familyId: string | null;
  closingPrice: string | null;
}
interface SimProduct {
  name: string;
  variations: Map<string, SimVariation>;
}
interface SimCatalog {
  products: Map<string, SimProduct>;
}

function newCatalog(): SimCatalog {
  return { products: new Map() };
}

function priceChanged(a: string | null, b: string | null): boolean {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return Number(a) !== Number(b);
}

/**
 * Reproduz FIELMENTE a regra do servidor (ProductsService.syncCatalog):
 * cria anúncios/variações novos, atualiza só os campos importados da Shopee quando
 * mudam e preserva família/preço de fechamento. Muta o catálogo em memória.
 */
function simulateSync(catalog: SimCatalog, rows: ProductRowData[]) {
  const valid = rows.filter((r) => !r.error && r.shopeeProductId);
  const errorRows = rows.filter((r) => r.error).length;

  const productIds = new Set<string>();
  const nameByShopeeId = new Map<string, string>();
  for (const r of valid) {
    const sid = r.shopeeProductId!;
    productIds.add(sid);
    if (!nameByShopeeId.has(sid) && r.productName) nameByShopeeId.set(sid, r.productName);
  }

  let newProducts = 0;
  let updatedRecords = 0;
  let newVariations = 0;
  let unchangedRecords = 0;

  // Anúncios.
  for (const sid of productIds) {
    const name = nameByShopeeId.get(sid) ?? sid;
    const existing = catalog.products.get(sid);
    if (!existing) {
      catalog.products.set(sid, { name, variations: new Map() });
      newProducts++;
    } else if (existing.name !== name) {
      existing.name = name;
      updatedRecords++;
    }
  }

  // Variações (dedup dentro do arquivo: última linha da chave vence).
  const lastRowByKey = new Map<string, ProductRowData>();
  for (const r of valid) lastRowByKey.set(`${r.shopeeProductId}|${r.variationKey}`, r);

  for (const r of lastRowByKey.values()) {
    const product = catalog.products.get(r.shopeeProductId!)!;
    const existing = product.variations.get(r.variationKey);
    if (!existing) {
      product.variations.set(r.variationKey, {
        shopeeVariationId: r.shopeeVariationId,
        variationName: r.variationName,
        sku: r.sku,
        referenceSku: r.referenceSku,
        gtin: r.gtin,
        shopeeFullPrice: r.shopeeFullPrice,
        sellerStock: r.sellerStock,
        failReason: r.failReason,
        familyId: null,
        closingPrice: null,
      });
      newVariations++;
    } else {
      const changed =
        (existing.variationName ?? null) !== (r.variationName ?? null) ||
        (existing.sku ?? null) !== (r.sku ?? null) ||
        (existing.referenceSku ?? null) !== (r.referenceSku ?? null) ||
        (existing.gtin ?? null) !== (r.gtin ?? null) ||
        (existing.sellerStock ?? null) !== (r.sellerStock ?? null) ||
        (existing.failReason ?? null) !== (r.failReason ?? null) ||
        priceChanged(existing.shopeeFullPrice, r.shopeeFullPrice);
      if (changed) {
        // Atualiza SÓ os campos da Shopee; família/preço de fechamento intactos.
        existing.variationName = r.variationName;
        existing.sku = r.sku;
        existing.referenceSku = r.referenceSku;
        existing.gtin = r.gtin;
        existing.shopeeFullPrice = r.shopeeFullPrice;
        existing.sellerStock = r.sellerStock;
        existing.failReason = r.failReason;
        existing.shopeeVariationId = r.shopeeVariationId;
        updatedRecords++;
      } else {
        unchangedRecords++;
      }
    }
  }

  return {
    productsSeen: productIds.size,
    variationsSeen: lastRowByKey.size,
    newProducts,
    newVariations,
    updatedRecords,
    unchangedRecords,
    errorRows,
  };
}

/** Visão agrupada por anúncio do catálogo atual (para a UI). */
function snapshot(catalog: SimCatalog) {
  return [...catalog.products.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([shopeeProductId, p]) => {
      const variations = [...p.variations.values()];
      const prices = variations
        .map((v) => (v.shopeeFullPrice != null ? Number(v.shopeeFullPrice) : null))
        .filter((n): n is number => n != null);
      return {
        shopeeProductId,
        name: p.name,
        variationCount: variations.length,
        priceMin: prices.length ? Math.min(...prices) : null,
        priceMax: prices.length ? Math.max(...prices) : null,
        variations,
      };
    });
}

(globalThis as unknown as { HomologProdutos: unknown }).HomologProdutos = {
  parseProductSheet,
  newCatalog,
  simulateSync,
  snapshot,
  toBuffer: (ab: ArrayBuffer) => Buffer.from(new Uint8Array(ab)),
};
