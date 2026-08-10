'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { dateBR } from '@/lib/format';
import { ProductImporter } from '@/components/ProductImporter';

interface Account { id: string; displayName: string }
interface FamilyLite {
  id: string;
  name: string;
  currentCostAmount: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}
interface Variation {
  id: string;
  shopeeVariationId: string;
  variationName: string | null;
  sku: string | null;
  referenceSku: string | null;
  gtin: string | null;
  shopeeFullPrice: string | null;
  closingPrice: string | null;
  sellerStock: number | null;
  failReason: string | null;
  familyId: string | null;
  family: { id: string; name: string; currentCostAmount: string | null } | null;
}
interface Product {
  id: string;
  shopeeProductId: string;
  name: string;
  variationCount: number;
  priceMin: string | null;
  priceMax: string | null;
  variationsWithoutFamily: number;
  lastSeenAt: string;
  variations: Variation[];
}
interface Stats {
  products: number;
  variations: number;
  variationsWithoutFamily: number;
  variationsWithoutClosingPrice: number;
  families: number;
}
interface ProductBatch {
  id: string;
  originalFilename: string;
  status: string;
  productsSeen: number;
  variationsSeen: number;
  newProducts: number;
  newVariations: number;
  updatedRecords: number;
  errorRows: number;
  createdAt: string;
  createdBy: { name: string } | null;
}

const brl = (v: string | null) =>
  v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ProdutosPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'FINANCIAL';

  const [account, setAccount] = useState<Account | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [families, setFamilies] = useState<FamilyLite[]>([]);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [familyFilter, setFamilyFilter] = useState<'' | 'with' | 'without'>('');
  const [closingFilter, setClosingFilter] = useState<'' | 'with' | 'without'>('');

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [batches, setBatches] = useState<ProductBatch[]>([]);

  useEffect(() => {
    api.get<Account[]>('/marketplace-accounts').then((rows) => setAccount(rows[0] ?? null));
  }, []);

  const loadAux = useCallback(() => {
    if (!account) return;
    api.get<Stats>(`/products/stats?marketplaceAccountId=${account.id}`).then(setStats);
    api.get<FamilyLite[]>(`/products/families?marketplaceAccountId=${account.id}`).then(setFamilies);
  }, [account]);

  const loadProducts = useCallback(() => {
    if (!account) return;
    setLoading(true);
    const p = new URLSearchParams({ marketplaceAccountId: account.id, page: String(page) });
    if (search.trim()) p.set('search', search.trim());
    if (familyFilter) p.set('family', familyFilter);
    if (closingFilter) p.set('closingPrice', closingFilter);
    api
      .get<{ total: number; items: Product[] }>(`/products?${p.toString()}`)
      .then((res) => { setItems(res.items); setTotal(res.total); })
      .finally(() => setLoading(false));
  }, [account, page, search, familyFilter, closingFilter]);

  useEffect(() => { loadAux(); }, [loadAux]);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  function reloadAll() {
    loadAux();
    loadProducts();
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleSelectProduct(p: Product, on: boolean) {
    setSelected((prev) => {
      const n = new Set(prev);
      p.variations.forEach((v) => (on ? n.add(v.id) : n.delete(v.id)));
      return n;
    });
  }

  async function openHistory() {
    if (!account) return;
    const rows = await api.get<ProductBatch[]>(`/products/import-batches?marketplaceAccountId=${account.id}`);
    setBatches(rows);
    setShowHistory(true);
  }

  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Produtos Shopee</h2>
          <p>Anúncios e variações importados da Shopee. Classifique as variações em famílias para atribuir custo.</p>
        </div>
        <button className="btn-sm" onClick={openHistory}>Histórico de importações</button>
      </div>

      {!canEdit && (
        <div className="info-banner">Seu perfil (Consulta) pode visualizar os produtos, mas não importar nem classificar.</div>
      )}

      {stats && (
        <div className="kpi-grid">
          <div className="kpi"><div className="lbl">Anúncios cadastrados</div><div className="val">{stats.products}</div></div>
          <div className="kpi"><div className="lbl">Variações / SKUs</div><div className="val">{stats.variations}</div></div>
          <div className="kpi"><div className="lbl">SKUs sem família</div><div className="val" style={stats.variationsWithoutFamily ? { color: 'var(--warn)' } : undefined}>{stats.variationsWithoutFamily}</div></div>
          <div className="kpi"><div className="lbl">SKUs sem preço de fechamento</div><div className="val" style={stats.variationsWithoutClosingPrice ? { color: 'var(--warn)' } : undefined}>{stats.variationsWithoutClosingPrice}</div></div>
        </div>
      )}

      {canEdit && account && <ProductImporter accountId={account.id} onDone={reloadAll} />}

      <div className="panel">
        <div className="ph">
          <h3>Anúncios e variações</h3>
          <span className="footnote" style={{ margin: 0 }}>{total} anúncio(s)</span>
        </div>
        <div className="pb">
          <div className="toolbar">
            <input
              className="input"
              style={{ width: 260 }}
              placeholder="Buscar por nome, ID do Produto ou SKU"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            <select className="select" value={familyFilter} onChange={(e) => { setFamilyFilter(e.target.value as any); setPage(1); }}>
              <option value="">Família: todas</option>
              <option value="without">Sem família</option>
              <option value="with">Com família</option>
            </select>
            <select className="select" value={closingFilter} onChange={(e) => { setClosingFilter(e.target.value as any); setPage(1); }}>
              <option value="">Preço de fechamento: todos</option>
              <option value="without">Sem preço de fechamento</option>
              <option value="with">Com preço de fechamento</option>
            </select>
            {canEdit && selected.size > 0 && (
              <button className="btn-sm primary" onClick={() => setClassifyOpen(true)}>
                Classificar família ({selected.size})
              </button>
            )}
          </div>
        </div>
        <div className="pb" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty">Carregando…</div>
          ) : items.length === 0 ? (
            <div className="empty">
              <div className="ico">◫</div>
              <p>Nenhum produto encontrado. {canEdit && 'Importe a planilha da Shopee acima para começar.'}</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th style={{ width: 28 }}></th>
                    <th>Produto</th>
                    <th>ID do Produto</th>
                    <th>Variações</th>
                    <th>Preço cheio</th>
                    <th>Família</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => {
                    const allSel = p.variations.length > 0 && p.variations.every((v) => selected.has(v.id));
                    const isOpen = expanded.has(p.id);
                    return (
                      <ProductRows
                        key={p.id}
                        product={p}
                        isOpen={isOpen}
                        allSelected={allSel}
                        selected={selected}
                        canEdit={canEdit}
                        onToggleExpand={() => toggleExpand(p.id)}
                        onToggleProduct={(on) => toggleSelectProduct(p, on)}
                        onToggleVariation={toggleSelect}
                        onChanged={reloadAll}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {pageCount > 1 && (
          <div className="pb" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
            <button className="btn-sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Anterior</button>
            <span className="footnote" style={{ margin: 0 }}>página {page} de {pageCount}</span>
            <button className="btn-sm" disabled={page >= pageCount} onClick={() => setPage((n) => n + 1)}>Próxima</button>
          </div>
        )}
      </div>

      {classifyOpen && account && (
        <ClassifyModal
          families={families}
          count={selected.size}
          onClose={() => setClassifyOpen(false)}
          onConfirm={async (familyId) => {
            await api.post('/products/classify', { variationIds: [...selected], familyId });
            setSelected(new Set());
            setClassifyOpen(false);
            reloadAll();
          }}
        />
      )}

      {showHistory && (
        <HistoryModal batches={batches} onClose={() => setShowHistory(false)} />
      )}
    </>
  );
}

function ProductRows({
  product, isOpen, allSelected, selected, canEdit,
  onToggleExpand, onToggleProduct, onToggleVariation, onChanged,
}: {
  product: Product;
  isOpen: boolean;
  allSelected: boolean;
  selected: Set<string>;
  canEdit: boolean;
  onToggleExpand: () => void;
  onToggleProduct: (on: boolean) => void;
  onToggleVariation: (id: string) => void;
  onChanged: () => void;
}) {
  const priceRange =
    product.priceMin == null ? '—'
      : product.priceMin === product.priceMax ? brl(product.priceMin)
        : `${brl(product.priceMin)} a ${brl(product.priceMax)}`;
  return (
    <>
      <tr style={{ background: isOpen ? '#f8faff' : undefined }}>
        <td>
          {canEdit && (
            <input type="checkbox" checked={allSelected} onChange={(e) => onToggleProduct(e.target.checked)} />
          )}
        </td>
        <td>
          <button className="btn-sm" style={{ padding: '2px 8px' }} onClick={onToggleExpand}>{isOpen ? '▾' : '▸'}</button>
        </td>
        <td><b>{product.name}</b></td>
        <td className="mono">{product.shopeeProductId}</td>
        <td>
          {product.variationCount}
          {product.variationsWithoutFamily > 0 && (
            <span className="badge b-warn" style={{ marginLeft: 6 }}>{product.variationsWithoutFamily} sem família</span>
          )}
        </td>
        <td>{priceRange}</td>
        <td className="footnote" style={{ margin: 0 }}>atualizado {dateBR(product.lastSeenAt)}</td>
      </tr>
      {isOpen && product.variations.map((v) => (
        <VariationRow
          key={v.id}
          variation={v}
          canEdit={canEdit}
          checked={selected.has(v.id)}
          onToggle={() => onToggleVariation(v.id)}
          onChanged={onChanged}
        />
      ))}
    </>
  );
}

function VariationRow({
  variation: v, canEdit, checked, onToggle, onChanged,
}: {
  variation: Variation;
  canEdit: boolean;
  checked: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(v.closingPrice ?? '');
  const [saving, setSaving] = useState(false);

  async function save(closingPrice: string | null) {
    setSaving(true);
    try {
      await api.patch(`/products/variations/${v.id}`, { closingPrice });
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>{canEdit && <input type="checkbox" checked={checked} onChange={onToggle} />}</td>
      <td></td>
      <td colSpan={5} style={{ paddingLeft: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1.2fr', gap: 12, alignItems: 'center', fontSize: 12.5 }}>
          <div>
            <b>{v.variationName ?? '(sem nome)'}</b>
            <div className="footnote" style={{ margin: 0 }}>SKU: <span className="mono">{v.sku ?? '—'}</span></div>
          </div>
          <div>
            <div className="footnote" style={{ margin: 0 }}>Preço cheio</div>
            {brl(v.shopeeFullPrice) ?? '—'}
          </div>
          <div>
            <div className="footnote" style={{ margin: 0 }}>Preço de fechamento</div>
            {editing ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input className="input" style={{ width: 90, padding: '4px 6px' }} value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" />
                <button className="btn-sm" disabled={saving} onClick={() => save(value === '' ? null : value)}>✓</button>
                <button className="btn-sm" onClick={() => { setEditing(false); setValue(v.closingPrice ?? ''); }}>×</button>
              </div>
            ) : v.closingPrice != null ? (
              <span>{brl(v.closingPrice)} {canEdit && <button className="btn-sm" style={{ padding: '1px 6px' }} onClick={() => setEditing(true)}>editar</button>}</span>
            ) : (
              <span className="footnote" style={{ margin: 0, color: 'var(--warn)' }}>
                não informado {canEdit && <button className="btn-sm" style={{ padding: '1px 6px' }} onClick={() => setEditing(true)}>definir</button>}
              </span>
            )}
          </div>
          <div>
            <div className="footnote" style={{ margin: 0 }}>Estoque</div>
            {v.sellerStock ?? '—'}
          </div>
          <div>
            <div className="footnote" style={{ margin: 0 }}>Família</div>
            {v.family ? (
              <span className="badge b-info">{v.family.name}{v.family.currentCostAmount != null ? ` · ${brl(v.family.currentCostAmount)}` : ' · sem custo'}</span>
            ) : (
              <span className="badge b-warn">sem família</span>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function ClassifyModal({
  families, count, onClose, onConfirm,
}: {
  families: FamilyLite[];
  count: number;
  onClose: () => void;
  onConfirm: (familyId: string | null) => Promise<void>;
}) {
  const [familyId, setFamilyId] = useState('');
  const [saving, setSaving] = useState(false);
  const active = useMemo(() => families.filter((f) => f.status === 'ACTIVE'), [families]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>Classificar família</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="mbd">
          <p className="footnote" style={{ marginTop: 0 }}>{count} variação(ões) selecionada(s) receberão a família escolhida.</p>
          <label className="fld">Família</label>
          <select className="select" style={{ width: '100%' }} value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
            <option value="">— remover família —</option>
            {active.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}{f.currentCostAmount != null ? ` (${brl(f.currentCostAmount)})` : ' (sem custo)'}
              </option>
            ))}
          </select>
          {active.length === 0 && (
            <div className="footnote" style={{ color: 'var(--warn)' }}>Nenhuma família cadastrada ainda. Crie famílias na aba “Famílias”.</div>
          )}
        </div>
        <div className="mf">
          <button className="btn-sm" onClick={onClose}>Cancelar</button>
          <button
            className="btn-sm primary"
            disabled={saving}
            onClick={async () => { setSaving(true); try { await onConfirm(familyId || null); } finally { setSaving(false); } }}
          >
            {saving ? 'Aplicando…' : 'Aplicar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ batches, onClose }: { batches: ProductBatch[]; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 820, maxWidth: '96vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>Histórico de importações de produtos</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="mbd" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          {batches.length === 0 ? (
            <div className="empty">Nenhuma importação de produtos ainda.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Arquivo</th><th>Anúncios</th><th>Variações</th><th>Novos</th><th>Atualizados</th><th>Erros</th><th>Data</th><th>Usuário</th></tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td><div style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.originalFilename}</div></td>
                      <td>{b.productsSeen}</td>
                      <td>{b.variationsSeen}</td>
                      <td>{b.newProducts + b.newVariations}</td>
                      <td>{b.updatedRecords}</td>
                      <td>{b.errorRows > 0 ? <b style={{ color: 'var(--err)' }}>{b.errorRows}</b> : 0}</td>
                      <td className="footnote" style={{ margin: 0 }}>{dateBR(b.createdAt)}</td>
                      <td className="footnote" style={{ margin: 0 }}>{b.createdBy?.name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="mf"><button className="btn-sm primary" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
