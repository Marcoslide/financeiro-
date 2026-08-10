'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProductImportSummary } from '@financeiro/shared';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { ProductTabs } from '@/components/products/ProductTabs';
import { ImportBar } from '@/components/products/ImportBar';

interface Account { id: string; displayName: string }
interface FamilyLite { id: string; name: string; currentCostAmount: string | null; status: 'ACTIVE' | 'INACTIVE' }
interface Variation {
  id: string; shopeeVariationId: string; variationName: string | null; sku: string | null;
  referenceSku: string | null; gtin: string | null; shopeeFullPrice: string | null;
  closingPrice: string | null; sellerStock: number | null; failReason: string | null;
  familyId: string | null; family: { id: string; name: string; currentCostAmount: string | null } | null; matched: boolean;
}
interface Product {
  id: string; shopeeProductId: string; name: string; status: 'ACTIVE' | 'INACTIVE';
  variationCount: number; totalStock: number; priceMin: string | null; priceMax: string | null;
  variationsWithoutFamily: number; variationsWithoutClosingPrice: number;
  familySummary: 'none' | 'single' | 'multiple'; autoExpand: boolean; lastSeenAt: string; variations: Variation[];
}
interface Stats { products: number; variations: number; variationsWithoutFamily: number; variationsWithoutClosingPrice: number; families: number }

const brl = (v: string | number | null) =>
  v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const SORTS: { v: string; l: string }[] = [
  { v: 'name_asc', l: 'Nome A–Z' }, { v: 'name_desc', l: 'Nome Z–A' },
  { v: 'stock_desc', l: 'Maior estoque' }, { v: 'stock_asc', l: 'Menor estoque' },
  { v: 'price_desc', l: 'Maior preço' }, { v: 'price_asc', l: 'Menor preço' },
  { v: 'variations_desc', l: 'Mais variações' }, { v: 'variations_asc', l: 'Menos variações' },
  { v: 'without_family', l: 'Sem família primeiro' }, { v: 'without_closing', l: 'Sem preço fechamento primeiro' },
];

const emptyFilters = { search: '', familyId: '', family: '', closingPrice: '', stock: '', variations: '', status: '', sort: 'name_asc' };
type Filters = typeof emptyFilters;

export default function ProdutosPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'FINANCIAL';

  const [account, setAccount] = useState<Account | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [families, setFamilies] = useState<FamilyLite[]>([]);
  const [lastImportAt, setLastImportAt] = useState<string | null>(null);

  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [matchedVariations, setMatchedVariations] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [searchInput, setSearchInput] = useState('');

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFiltered, setAllFiltered] = useState(false);

  const [classifyOpen, setClassifyOpen] = useState(false);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [editVar, setEditVar] = useState<{ product: Product; variation: Variation } | null>(null);
  const [toast, setToast] = useState<{ title: string; body: string; err?: boolean } | null>(null);

  useEffect(() => {
    api.get<Account[]>('/marketplace-accounts').then((rows) => setAccount(rows[0] ?? null));
  }, []);

  // Debounce da busca
  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => ({ ...f, search: searchInput })); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadAux = useCallback(() => {
    if (!account) return;
    api.get<Stats>(`/products/stats?marketplaceAccountId=${account.id}`).then(setStats);
    api.get<FamilyLite[]>(`/products/families?marketplaceAccountId=${account.id}`).then(setFamilies);
    api.get<{ createdAt: string }[]>(`/products/import-batches?marketplaceAccountId=${account.id}`)
      .then((b) => setLastImportAt(b[0]?.createdAt ?? null));
  }, [account]);

  const params = useCallback(() => {
    const p = new URLSearchParams({ marketplaceAccountId: account!.id, page: String(page), pageSize: String(pageSize) });
    (Object.keys(filters) as (keyof Filters)[]).forEach((k) => { if (filters[k]) p.set(k, filters[k]); });
    return p;
  }, [account, page, pageSize, filters]);

  const loadProducts = useCallback(() => {
    if (!account) return;
    setLoading(true);
    api.get<{ total: number; matchedVariations: number; items: Product[] }>(`/products?${params().toString()}`)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setMatchedVariations(res.matchedVariations);
        if (filters.search) setExpanded((prev) => { const n = new Set(prev); res.items.forEach((i) => i.autoExpand && n.add(i.id)); return n; });
      })
      .finally(() => setLoading(false));
  }, [account, params, filters.search]);

  useEffect(() => { loadAux(); }, [loadAux]);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  function reloadAll() { loadAux(); loadProducts(); }
  function setFilter(patch: Partial<Filters>) { setFilters((f) => ({ ...f, ...patch })); setPage(1); setAllFiltered(false); }
  function clearFilters() { setFilters(emptyFilters); setSearchInput(''); setPage(1); setAllFiltered(false); }

  // ---- Seleção ----
  const pageVariationIds = useMemo(() => items.flatMap((p) => p.variations.map((v) => v.id)), [items]);
  const pageAllSelected = pageVariationIds.length > 0 && pageVariationIds.every((id) => selected.has(id));

  function toggleVariation(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setAllFiltered(false);
  }
  function toggleMaster(p: Product, on: boolean) {
    setSelected((prev) => { const n = new Set(prev); p.variations.forEach((v) => (on ? n.add(v.id) : n.delete(v.id))); return n; });
    setAllFiltered(false);
  }
  function togglePage(on: boolean) {
    setSelected((prev) => { const n = new Set(prev); pageVariationIds.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
    setAllFiltered(false);
  }
  function clearSelection() { setSelected(new Set()); setAllFiltered(false); }

  async function selectAllFiltered() {
    const res = await api.get<{ variationIds: string[]; truncated: boolean }>(`/products/variation-ids?${params().toString()}`);
    setSelected(new Set(res.variationIds));
    setAllFiltered(true);
    if (res.truncated) setToast({ title: 'Seleção limitada', body: 'Muitos resultados; selecionados os primeiros 20.000 SKUs.', err: true });
  }

  function expandAll() { setExpanded(new Set(items.map((p) => p.id))); }
  function collapseAll() { setExpanded(new Set()); }

  function onImported(s: ProductImportSummary) {
    reloadAll();
    setToast({
      title: s.status === 'COMPLETED' ? 'Importação concluída' : 'Importação concluída com erros',
      body: `${s.totalRows} variações processadas · ${s.newProducts + s.newVariations} novas · ${s.updatedRecords} atualizadas · ${s.unchangedRecords} sem alteração · ${s.errorRows} erros`,
      err: s.errorRows > 0,
    });
  }

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const filteredView = useMemo(
    () => Object.entries(filters).some(([k, v]) => v && !(k === 'sort' && v === 'name_asc')),
    [filters],
  );

  return (
    <>
      <div className="page-head">
        <div><h2>Produtos</h2><p>Catálogo Shopee: anúncios, variações/SKUs, famílias e custos.</p></div>
      </div>
      <ProductTabs />

      {account && (
        <ImportBar
          accountId={account.id}
          products={stats?.products ?? 0}
          variations={stats?.variations ?? 0}
          lastImportAt={lastImportAt}
          onDone={onImported}
        />
      )}

      {stats && (
        <div className="kpi-grid">
          <Kpi label="Anúncios" val={stats.products} onClick={() => clearFilters()} />
          <Kpi label="Variações / SKUs" val={stats.variations} onClick={() => clearFilters()} />
          <Kpi label="SKUs sem família" val={stats.variationsWithoutFamily} warn on={filters.family === 'without'}
            onClick={() => setFilter({ family: 'without', closingPrice: '', sort: 'without_family' })} />
          <Kpi label="SKUs sem preço de fechamento" val={stats.variationsWithoutClosingPrice} warn on={filters.closingPrice === 'without'}
            onClick={() => setFilter({ closingPrice: 'without', family: '', sort: 'without_closing' })} />
        </div>
      )}

      <div className="panel">
        <div className="pb">
          <div className="toolbar2">
            <input className="input sm" style={{ width: 260 }} placeholder="Buscar produto, SKU ou ID…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            <Sel value={filters.familyId} onChange={(v) => setFilter({ familyId: v, family: '' })} custom={
              <>
                <option value="">Família: todas</option>
                {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </>
            } />
            <Sel value={filters.family} onChange={(v) => setFilter({ family: v, familyId: '' })} custom={
              <><option value="">Classificação: todos</option><option value="with">Com família</option><option value="without">Sem família</option></>
            } />
            <Sel value={filters.closingPrice} onChange={(v) => setFilter({ closingPrice: v })} custom={
              <><option value="">Preço fechamento: todos</option><option value="with">Configurado</option><option value="without">Não configurado</option></>
            } />
            <Sel value={filters.stock} onChange={(v) => setFilter({ stock: v })} custom={
              <><option value="">Estoque: todos</option><option value="with">Com estoque</option><option value="without">Sem estoque</option><option value="zero">Estoque zerado</option></>
            } />
            <Sel value={filters.variations} onChange={(v) => setFilter({ variations: v })} custom={
              <><option value="">Variações: todas</option><option value="single">Sem variação</option><option value="multiple">Com variações</option></>
            } />
            <Sel value={filters.status} onChange={(v) => setFilter({ status: v })} custom={
              <><option value="">Status: todos</option><option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option></>
            } />
            <Sel value={filters.sort} onChange={(v) => setFilter({ sort: v })} custom={<>{SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</>} />
            {filteredView && <button className="link-btn" onClick={clearFilters}>Limpar filtros</button>}
          </div>

          <div className="count-line">
            {filteredView ? <><b>{total.toLocaleString('pt-BR')}</b> de {stats?.products.toLocaleString('pt-BR')} anúncios</> : <><b>{total.toLocaleString('pt-BR')}</b> anúncios</>}
            {' · '}<b>{matchedVariations.toLocaleString('pt-BR')}</b> variações/SKUs correspondentes
            {' · '}<button className="link-btn" onClick={expandAll}>Expandir todos</button>
            {' / '}<button className="link-btn" onClick={collapseAll}>Recolher todos</button>
          </div>

          {pageAllSelected && !allFiltered && total > items.length && (
            <div className="selbanner">
              <span>Os {pageVariationIds.length} SKUs desta página estão selecionados.</span>
              <button className="link-btn" onClick={selectAllFiltered}>Selecionar todos os {matchedVariations.toLocaleString('pt-BR')} SKUs encontrados</button>
            </div>
          )}
          {allFiltered && (
            <div className="selbanner">
              <span>Todos os {selected.size.toLocaleString('pt-BR')} SKUs encontrados estão selecionados.</span>
              <button className="link-btn" onClick={clearSelection}>Limpar seleção</button>
            </div>
          )}
        </div>

        <div className="pb" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty">Carregando…</div>
          ) : items.length === 0 ? (
            <div className="empty"><div className="ico">◫</div><p>Nenhum produto encontrado.{canEdit && ' Importe a planilha da Shopee acima ou ajuste os filtros.'}</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>{canEdit && <Chk checked={pageAllSelected} onChange={(e) => togglePage(e.target.checked)} />}</th>
                    <th style={{ width: 26 }}></th>
                    <th>Produto</th>
                    <th>ID Shopee</th>
                    <th>Variações</th>
                    <th>Faixa de preço</th>
                    <th>Estoque</th>
                    <th>Parametrização</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <MasterRows
                      key={p.id}
                      product={p}
                      open={expanded.has(p.id)}
                      selected={selected}
                      canEdit={canEdit}
                      onToggleExpand={() => setExpanded((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
                      onToggleMaster={(on) => toggleMaster(p, on)}
                      onToggleVariation={toggleVariation}
                      onEdit={(v) => setEditVar({ product: p, variation: v })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {(total > pageSize || pageSize !== 25) && (
          <div className="pb" style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="seg">
              {[25, 50, 100].map((n) => (
                <button key={n} className={pageSize === n ? 'on' : ''} onClick={() => { setPageSize(n); setPage(1); }}>{n}/pág</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn-sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Anterior</button>
              <span className="footnote" style={{ margin: 0 }}>página {page} de {Math.max(1, Math.ceil(total / pageSize))}</span>
              <button className="btn-sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((n) => n + 1)}>Próxima</button>
            </div>
          </div>
        )}
      </div>

      {canEdit && selected.size > 0 && (
        <div className="bulkbar">
          <b>{selected.size.toLocaleString('pt-BR')} variação(ões) selecionada(s)</b>
          <div className="spacer" />
          <button className="btn-sm primary" onClick={() => setClassifyOpen(true)}>Atribuir família</button>
          <button className="btn-sm" onClick={() => setBulkPriceOpen(true)}>Definir preço de fechamento</button>
          <button className="btn-sm" onClick={() => setStatusBulk('INACTIVE')}>Inativar</button>
          <button className="btn-sm" onClick={() => setStatusBulk('ACTIVE')}>Ativar</button>
          <button className="btn-sm" onClick={clearSelection}>Limpar</button>
        </div>
      )}

      {classifyOpen && account && (
        <ClassifyModal
          accountId={account.id}
          families={families}
          selectedIds={[...selected]}
          onClose={() => setClassifyOpen(false)}
          onFamiliesChanged={loadAux}
          onApplied={(msg) => { setClassifyOpen(false); clearSelection(); reloadAll(); setToast({ title: 'Família atribuída', body: msg }); }}
        />
      )}
      {bulkPriceOpen && (
        <BulkPriceModal
          count={selected.size}
          onClose={() => setBulkPriceOpen(false)}
          onApply={async (price) => {
            await api.post('/products/bulk', { variationIds: [...selected], closingPrice: price });
            setBulkPriceOpen(false); clearSelection(); reloadAll();
            setToast({ title: 'Preço de fechamento definido', body: `Aplicado a ${selected.size} variação(ões).` });
          }}
        />
      )}
      {editVar && (
        <EditDrawer
          product={editVar.product}
          variation={editVar.variation}
          families={families}
          canEdit={canEdit}
          onClose={() => setEditVar(null)}
          onSaved={() => { setEditVar(null); reloadAll(); setToast({ title: 'Variação atualizada', body: 'Alterações salvas.' }); }}
        />
      )}
      {toast && (
        <div className={`toast ${toast.err ? 'err' : ''}`}>
          <div className="tt">{toast.title}</div>
          <div>{toast.body}</div>
        </div>
      )}
    </>
  );

  async function setStatusBulk(status: 'ACTIVE' | 'INACTIVE') {
    await api.post('/products/bulk', { variationIds: [...selected], status });
    clearSelection(); reloadAll();
    setToast({ title: 'Status alterado', body: `Anúncios ${status === 'ACTIVE' ? 'ativados' : 'inativados'}.` });
  }
}

// ============================ Sub-componentes ============================

function Kpi({ label, val, onClick, warn, on }: { label: string; val: number; onClick?: () => void; warn?: boolean; on?: boolean }) {
  return (
    <div className={`kpi ${onClick ? 'clickable' : ''} ${on ? 'on' : ''}`} onClick={onClick}>
      <div className="lbl">{label}</div>
      <div className={`val small ${warn && val > 0 ? '' : ''}`} style={warn && val > 0 ? { color: 'var(--warn)' } : undefined}>{val.toLocaleString('pt-BR')}</div>
    </div>
  );
}

function Sel({ value, onChange, custom }: { value: string; onChange: (v: string) => void; custom: React.ReactNode }) {
  return <select className="select sm" value={value} onChange={(e) => onChange(e.target.value)}>{custom}</select>;
}

function Chk({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate && !checked; }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" className="chk" checked={checked} onChange={onChange} />;
}

function familyBadge(summary: Product['familySummary']) {
  if (summary === 'none') return <span className="tag warn">sem família</span>;
  if (summary === 'single') return <span className="tag ok">família única</span>;
  return <span className="tag info">múltiplas famílias</span>;
}

function MasterRows({
  product: p, open, selected, canEdit, onToggleExpand, onToggleMaster, onToggleVariation, onEdit,
}: {
  product: Product; open: boolean; selected: Set<string>; canEdit: boolean;
  onToggleExpand: () => void; onToggleMaster: (on: boolean) => void; onToggleVariation: (id: string) => void; onEdit: (v: Variation) => void;
}) {
  const selCount = p.variations.filter((v) => selected.has(v.id)).length;
  const allSel = p.variations.length > 0 && selCount === p.variations.length;
  const priceRange = p.priceMin == null ? '—' : p.priceMin === p.priceMax ? brl(p.priceMin) : `${brl(p.priceMin)} — ${brl(p.priceMax)}`;
  return (
    <>
      <tr className="master-row">
        <td>{canEdit && <Chk checked={allSel} indeterminate={selCount > 0} onChange={(e) => onToggleMaster(e.target.checked)} />}</td>
        <td><button className="expander" onClick={onToggleExpand}>{open ? '▾' : '▸'}</button></td>
        <td>
          <div className="pname">{p.name}{p.status === 'INACTIVE' && <span className="tag" style={{ marginLeft: 6 }}>inativo</span>}</div>
        </td>
        <td className="mono">{p.shopeeProductId}</td>
        <td>{p.variationCount}</td>
        <td>{priceRange}</td>
        <td>{p.totalStock.toLocaleString('pt-BR')}</td>
        <td>
          {familyBadge(p.familySummary)}
          {p.variationsWithoutFamily > 0 && <span className="tag warn" style={{ marginLeft: 4 }}>{p.variationsWithoutFamily} s/ família</span>}
          {p.variationsWithoutClosingPrice > 0 && <span className="tag" style={{ marginLeft: 4 }}>{p.variationsWithoutClosingPrice} s/ fechamento</span>}
        </td>
        <td><button className="btn-sm" onClick={onToggleExpand}>{open ? 'Recolher' : 'Ver SKUs'}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ padding: 0 }}>
            <table style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Variação</th>
                  <th>SKU</th>
                  <th>Família</th>
                  <th>Preço Shopee</th>
                  <th>Preço Fechamento</th>
                  <th>Custo (herdado)</th>
                  <th>Estoque</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {p.variations.map((v) => (
                  <tr key={v.id} className={`subrow ${v.matched ? 'matched' : ''}`}>
                    <td>{canEdit && <input type="checkbox" className="chk" checked={selected.has(v.id)} onChange={() => onToggleVariation(v.id)} />}</td>
                    <td className="vname">{v.variationName ?? '(única)'}</td>
                    <td className="mono">{v.sku ?? '—'}</td>
                    <td>{v.family ? <span className="tag info">{v.family.name}</span> : <span className="tag warn">sem família</span>}</td>
                    <td>{brl(v.shopeeFullPrice) ?? '—'}</td>
                    <td>{v.closingPrice != null ? brl(v.closingPrice) : <span className="tag warn">não informado</span>}</td>
                    <td>{v.family?.currentCostAmount != null ? <span>{brl(v.family.currentCostAmount)} <span className="inh-cost">herdado</span></span> : '—'}</td>
                    <td>{v.sellerStock ?? '—'}</td>
                    <td>{canEdit && <button className="btn-sm" onClick={() => onEdit(v)}>Editar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// ---- Modal: atribuir família (com criação rápida e sugestão heurística) ----
function ClassifyModal({
  accountId, families, selectedIds, onClose, onApplied, onFamiliesChanged,
}: {
  accountId: string; families: FamilyLite[]; selectedIds: string[];
  onClose: () => void; onApplied: (msg: string) => void; onFamiliesChanged: () => void;
}) {
  const [familyId, setFamilyId] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [localFamilies, setLocalFamilies] = useState(families);
  const active = useMemo(() => localFamilies.filter((f) => f.status === 'ACTIVE'), [localFamilies]);
  const chosen = active.find((f) => f.id === familyId);

  async function apply() {
    setSaving(true);
    try {
      await api.post('/products/bulk', { variationIds: selectedIds, familyId: familyId || null });
      onApplied(`${selectedIds.length} SKUs vinculados${chosen ? ` a “${chosen.name}”` : ''}.`);
    } finally { setSaving(false); }
  }

  async function suggest() {
    setSuggesting(true);
    setSuggestion(null);
    try {
      const res = await api.post<{ suggestions: { suggestion: { familyId: string; familyName: string; confidence: number } | null }[] }>(
        '/products/suggest-families', { marketplaceAccountId: accountId, variationIds: selectedIds.slice(0, 200) });
      const counts = new Map<string, { name: string; conf: number; n: number }>();
      res.suggestions.forEach((s) => { if (s.suggestion) { const c = counts.get(s.suggestion.familyId) ?? { name: s.suggestion.familyName, conf: 0, n: 0 }; c.n++; c.conf = Math.max(c.conf, s.suggestion.confidence); counts.set(s.suggestion.familyId, c); } });
      const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      if (best) { setFamilyId(best[0]); setSuggestion(`Sugestão: “${best[1].name}” (${best[1].n}/${selectedIds.length} SKUs · confiança ${best[1].conf}%)`); }
      else setSuggestion('Nenhuma sugestão confiável para os SKUs selecionados.');
    } finally { setSuggesting(false); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>Atribuir família</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="mbd">
          <p className="footnote" style={{ marginTop: 0 }}>Você está atribuindo esta família a <b>{selectedIds.length}</b> variação(ões).</p>
          {!creating ? (
            <>
              <label className="fld">Família</label>
              <select className="select" style={{ width: '100%' }} value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
                <option value="">— remover família —</option>
                {active.map((f) => <option key={f.id} value={f.id}>{f.name}{f.currentCostAmount != null ? ` (${brl(f.currentCostAmount)})` : ' (sem custo)'}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center' }}>
                <button className="link-btn" onClick={() => setCreating(true)}>+ Criar nova família</button>
                <button className="link-btn" onClick={suggest} disabled={suggesting}>{suggesting ? 'Analisando…' : 'Sugerir família (heurística)'}</button>
              </div>
              {suggestion && <div className="footnote" style={{ color: 'var(--info)' }}>{suggestion}</div>}
              {chosen && (
                <div className="ro" style={{ marginTop: 12 }}>
                  Custo herdado: <b>{chosen.currentCostAmount != null ? brl(chosen.currentCostAmount) : 'não informado'}</b>
                </div>
              )}
            </>
          ) : (
            <QuickFamily
              accountId={accountId}
              onCancel={() => setCreating(false)}
              onCreated={(fam) => { setLocalFamilies((prev) => [...prev, fam]); setFamilyId(fam.id); setCreating(false); onFamiliesChanged(); }}
            />
          )}
        </div>
        {!creating && (
          <div className="mf">
            <button className="btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn-sm primary" disabled={saving} onClick={apply}>{saving ? 'Aplicando…' : `Aplicar a ${selectedIds.length} SKUs`}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickFamily({ accountId, onCancel, onCreated }: { accountId: string; onCancel: () => void; onCreated: (f: FamilyLite) => void }) {
  const [name, setName] = useState('');
  const [internalCode, setInternalCode] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true); setError(null);
    try {
      const f = await api.post<FamilyLite>('/products/families', { marketplaceAccountId: accountId, name, internalCode, notes, ...(cost.trim() ? { cost } : {}) });
      onCreated(f);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao criar família'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      {error && <div className="form-err" style={{ marginBottom: 10 }}>{error}</div>}
      <label className="fld">Nome da família *</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Quadro 40x60 Premium com Vidro" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label className="fld">Código interno</label><input className="input" value={internalCode} onChange={(e) => setInternalCode(e.target.value)} /></div>
        <div><label className="fld">Custo (R$)</label><input className="input" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" /></div>
      </div>
      <label className="fld">Observação</label>
      <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn-sm" onClick={onCancel}>Voltar</button>
        <button className="btn-sm primary" disabled={saving || !name.trim()} onClick={create}>{saving ? 'Criando…' : 'Criar e usar'}</button>
      </div>
    </div>
  );
}

function BulkPriceModal({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (price: string) => Promise<void> }) {
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>Preço de fechamento em massa</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="mbd">
          <p className="footnote" style={{ marginTop: 0 }}>Aplicar a <b>{count}</b> variação(ões). O preço Shopee não é alterado.</p>
          <label className="fld">Preço de fechamento (R$)</label>
          <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
        </div>
        <div className="mf">
          <button className="btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn-sm primary" disabled={saving || !price.trim()} onClick={async () => { setSaving(true); try { await onApply(price); } finally { setSaving(false); } }}>{saving ? 'Aplicando…' : 'Aplicar'}</button>
        </div>
      </div>
    </div>
  );
}

function EditDrawer({
  product, variation: v, families, canEdit, onClose, onSaved,
}: {
  product: Product; variation: Variation; families: FamilyLite[]; canEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [closingPrice, setClosingPrice] = useState(v.closingPrice ?? '');
  const [familyId, setFamilyId] = useState(v.familyId ?? '');
  const [saving, setSaving] = useState(false);
  const chosen = families.find((f) => f.id === familyId);
  const active = families.filter((f) => f.status === 'ACTIVE' || f.id === v.familyId);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/products/variations/${v.id}`, {
        closingPrice: closingPrice.trim() === '' ? null : closingPrice,
        familyId: familyId || null,
      });
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="drawer" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dh"><h3 style={{ margin: 0, fontSize: 16 }}>Editar variação</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="dbd">
          <label className="fld">Produto master</label>
          <div className="ro">{product.name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="fld">Variação</label><div className="ro">{v.variationName ?? '(única)'}</div></div>
            <div><label className="fld">SKU</label><div className="ro mono">{v.sku ?? '—'}</div></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="fld">ID variação Shopee</label><div className="ro mono">{v.shopeeVariationId || '(única)'}</div></div>
            <div><label className="fld">Estoque Shopee</label><div className="ro">{v.sellerStock ?? '—'}</div></div>
          </div>
          <label className="fld">Preço Shopee (importado)</label>
          <div className="ro">{brl(v.shopeeFullPrice) ?? '—'}</div>

          <label className="fld">Preço de fechamento (nosso)</label>
          <input className="input" value={closingPrice} onChange={(e) => setClosingPrice(e.target.value)} placeholder="Não informado" disabled={!canEdit} />

          <label className="fld">Família</label>
          <select className="select" style={{ width: '100%' }} value={familyId} onChange={(e) => setFamilyId(e.target.value)} disabled={!canEdit}>
            <option value="">— sem família —</option>
            {active.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>

          <label className="fld">Custo (herdado da família)</label>
          <div className="ro">{chosen?.currentCostAmount != null ? <><b>{brl(chosen.currentCostAmount)}</b> <span className="inh-cost">— herdado de “{chosen.name}”</span></> : <span className="inh-cost">o custo vem da família; selecione uma família com custo</span>}</div>
        </div>
        {canEdit && (
          <div className="df">
            <button className="btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn-sm primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
