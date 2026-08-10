'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { dateBR } from '@/lib/format';

interface Account { id: string; displayName: string }
const brl = (v: string | number | null | undefined) =>
  v == null ? 'R$ 0,00' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nn = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR');
const pctv = (v: string | number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('pt-BR') + '%');

const STATUS_TABS = [
  { key: 'ALL', label: 'Todos' }, { key: 'NAO_PAGO', label: 'Não pago' }, { key: 'A_ENVIAR', label: 'A enviar' },
  { key: 'ENVIADO', label: 'Enviado' }, { key: 'CONCLUIDO', label: 'Concluído' }, { key: 'CANCELADO', label: 'Cancelado' },
];

function periodRange(preset: string): { from?: string; to?: string } {
  const now = new Date(); const iso = (d: Date) => d.toISOString();
  if (preset === '7d') return { from: iso(new Date(now.getTime() - 7 * 864e5)) };
  if (preset === '30d') return { from: iso(new Date(now.getTime() - 30 * 864e5)) };
  if (preset === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  if (preset === 'prevmonth') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  return {};
}

export default function PedidosPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'FINANCIAL';
  const [account, setAccount] = useState<Account | null>(null);
  const [sub, setSub] = useState<'pedidos' | 'dashboard' | 'importacoes'>('pedidos');
  const [preset, setPreset] = useState('all');
  const [detail, setDetail] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { api.get<Account[]>('/marketplace-accounts').then((a) => setAccount(a[0] ?? null)); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const qp = useCallback(() => {
    const r = periodRange(preset); const p = new URLSearchParams({ marketplaceAccountId: account!.id });
    if (r.from) p.set('from', r.from); if (r.to) p.set('to', r.to);
    return p;
  }, [account, preset]);

  return (
    <>
      <div className="page-head">
        <div><h2>Pedidos</h2><p>Núcleo transacional das vendas. Importação idempotente — o mesmo pedido nunca duplica.</p></div>
        <select className="select sm" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="all">Todo o período</option><option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option><option value="month">Mês atual</option><option value="prevmonth">Mês anterior</option>
        </select>
      </div>
      <div className="tabs">
        {(['pedidos', 'dashboard', 'importacoes'] as const).map((t) => (
          <div key={t} className={`tab ${sub === t ? 'active' : ''}`} onClick={() => setSub(t)}>
            {t === 'pedidos' ? 'Pedidos' : t === 'dashboard' ? 'Dashboard' : 'Importações'}
          </div>
        ))}
      </div>
      {account && sub === 'pedidos' && <Lista qp={qp} onOpen={setDetail} />}
      {account && sub === 'dashboard' && <Dashboard qp={qp} />}
      {account && sub === 'importacoes' && <Importacoes accountId={account.id} canEdit={canEdit} onDone={setToast} />}
      {detail && <OrderDrawer id={detail} onClose={() => setDetail(null)} />}
      {toast && <div className="toast"><div className="tt">Pedidos</div><div>{toast}</div></div>}
    </>
  );
}

function useJson<T>(url: string | null): T | null {
  const [d, setD] = useState<T | null>(null);
  useEffect(() => { setD(null); if (url) api.get<T>(url).then(setD).catch(() => setD(null)); }, [url]);
  return d;
}

interface OrderRow {
  id: string; externalOrderId: string; normalizedStatus: string; normalizedLabel: string; orderCreatedAt: string | null;
  trackingNumber: string | null; itemCount: number; hasReturn: boolean; totalAmount: string | null; itemsSubtotal: string | null;
  marketplaceFeesTotal: string | null; estimatedResult: string | null; estimatedMarginPct: string | null; costPending: boolean;
  items: { sku: string | null; productName: string | null }[];
}

function Lista({ qp, onOpen }: { qp: () => URLSearchParams; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const p = qp(); p.set('tab', tab); p.set('sort', sort); p.set('page', String(page)); if (search) p.set('search', search);
  const data = useJson<{ total: number; page: number; pageSize: number; items: OrderRow[] }>(`/orders?${p.toString()}`);
  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <>
      <div className="tabs">
        {STATUS_TABS.map((t) => <div key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); setPage(1); }}>{t.label}</div>)}
      </div>
      <div className="toolbar2">
        <input className="input sm" style={{ width: 300 }} placeholder="Buscar ID, SKU, produto, rastreamento…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="select sm" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Mais recentes</option><option value="oldest">Mais antigos</option>
          <option value="sale_desc">Maior venda</option><option value="sale_asc">Menor venda</option>
          <option value="profit_desc">Maior lucro</option><option value="profit_asc">Menor lucro</option>
        </select>
      </div>
      <div className="count-line"><b>{nn(data?.total)}</b> pedidos</div>
      <div className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Pedido</th><th>Data</th><th>Status</th><th>Produto</th><th>Venda</th><th>Taxas</th><th>Lucro est.</th><th>Margem</th><th>Devolução</th><th></th></tr></thead>
        <tbody>
          {data?.items.length ? data.items.map((o) => (
            <tr key={o.id}>
              <td className="mono">{o.externalOrderId}</td>
              <td>{o.orderCreatedAt ? dateBR(o.orderCreatedAt).split(' ')[0] : '—'}</td>
              <td><span className={`pill ${o.normalizedStatus}`}>{o.normalizedLabel}</span></td>
              <td>{o.itemCount > 1 ? `${o.itemCount} produtos` : (o.items[0]?.productName ?? '—').slice(0, 40)}{o.itemCount > 1 && <span className="tag" style={{ marginLeft: 6 }}>multi</span>}</td>
              <td>{brl(o.itemsSubtotal)}</td>
              <td style={{ color: 'var(--err)' }}>{brl(o.marketplaceFeesTotal)}</td>
              <td>{o.estimatedResult == null ? <span className="tag warn">pendente</span> : <b style={{ color: 'var(--ok)' }}>{brl(o.estimatedResult)}</b>}</td>
              <td>{pctv(o.estimatedMarginPct)}</td>
              <td>{o.hasReturn ? <span className="tag warn">devolução</span> : ''}</td>
              <td><button className="btn-sm" onClick={() => onOpen(o.id)}>Abrir</button></td>
            </tr>
          )) : <tr><td colSpan={10} className="empty">{data ? 'Nenhum pedido.' : 'Carregando…'}</td></tr>}
        </tbody>
      </table></div></div>
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button className="btn-sm" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>Anterior</button>
          <span className="footnote" style={{ margin: 0 }}>página {page} de {pages}</span>
          <button className="btn-sm" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>Próxima</button>
        </div>
      )}
    </>
  );
}

function Dashboard({ qp }: { qp: () => URLSearchParams }) {
  const d = useJson<Record<string, number & Record<string, number>>>(`/orders/dashboard?${qp().toString()}`);
  if (!d) return <div className="panel"><div className="empty">Carregando…</div></div>;
  const sc = (d.statusCounts ?? {}) as Record<string, number>;
  const card = (l: string, v: string, cls = '') => <div className={`kpi ${cls}`}><div className="lbl">{l}</div><div className="val">{v}</div></div>;
  return (
    <>
      <div className="kpi-grid">
        {card('Venda real', brl(d.revenue as number))}
        {card('Ticket médio', brl(d.averageTicket as number))}
        {card('Unidades vendidas', nn(d.unitsSold as number))}
        {card('Taxas marketplace', brl(d.marketplaceFees as number))}
        {card('Custo produtos', brl(d.productCost as number))}
        {card('Resultado estimado', brl(d.estimatedResult as number))}
        {card('Margem estimada', pctv(d.estimatedMarginPct as number))}
        {card('SKUs sem custo', `${nn(d.costPendingOrders as number)} pedidos`)}
      </div>
      <div className="kpi-grid">
        {card('A enviar', nn(sc.A_ENVIAR ?? 0))}
        {card('Enviados', nn(sc.ENVIADO ?? 0))}
        {card('Concluídos', nn(sc.CONCLUIDO ?? 0))}
        {card('Cancelados', nn(d.cancellations as number))}
        {card('Devoluções vinculadas', nn(d.returns as number))}
        {card('SKUs sem vínculo', `${nn(d.skusUnlinkedOrders as number)} pedidos`)}
      </div>
      <div className="footnote">Resultado estimado é determinístico: receita (preço acordado) − taxas líquidas validadas − custo da família (snapshot). Custo ausente nunca é tratado como zero.</div>
    </>
  );
}

function Importacoes({ accountId, canEdit, onDone }: { accountId: string; canEdit: boolean; onDone: (m: string) => void }) {
  const [batches, setBatches] = useState<Record<string, string | number>[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get<Record<string, string | number>[]>(`/orders/import-batches?marketplaceAccountId=${accountId}`).then(setBatches); }, [accountId]);
  useEffect(() => { load(); }, [load]);

  function pick() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
    inp.onchange = () => {
      const f = inp.files?.[0]; if (!f) return; setBusy(true);
      const form = new FormData(); form.append('marketplaceAccountId', accountId); form.append('file', f);
      api.upload<Record<string, number>>('/orders/import', form)
        .then((r) => { onDone(`${r.ordersSeen} pedidos · ${r.newOrders} novos · ${r.updatedOrders} atualizados · ${r.unchangedOrders} sem alteração`); load(); })
        .catch((e) => onDone('Falha: ' + e.message)).finally(() => setBusy(false));
    };
    inp.click();
  }

  return (
    <>
      {canEdit && (
        <div className="importbar">
          <div><div className="ib-title">Importar planilha de pedidos</div><div className="ib-meta">Exportação “Order.all…” da Shopee (.xlsx). Reimportar o mesmo arquivo não duplica nada.</div></div>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn-sm primary" disabled={busy} onClick={pick}>{busy ? 'Processando…' : 'Selecionar arquivo'}</button>
        </div>
      )}
      <div className="panel"><div className="ph"><h3>Histórico de importações</h3><span className="footnote" style={{ margin: 0 }}>{batches.length}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Arquivo</th><th>Linhas</th><th>Pedidos</th><th>Novos</th><th>Atualizados</th><th>Sem alteração</th><th>Itens</th><th>Data</th></tr></thead>
          <tbody>
            {batches.length ? batches.map((b) => (
              <tr key={b.id as string}><td>{b.originalFilename as string}</td><td>{nn(b.rowsProcessed as number)}</td><td>{nn(b.ordersSeen as number)}</td><td>{nn(b.newOrders as number)}</td><td>{nn(b.updatedOrders as number)}</td><td>{nn(b.unchangedOrders as number)}</td><td>{nn(b.itemsSeen as number)}</td><td className="footnote" style={{ margin: 0 }}>{dateBR(b.createdAt as string)}</td></tr>
            )) : <tr><td colSpan={8} className="empty">Nenhuma importação ainda.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

interface OrderDetail {
  externalOrderId: string; orderStatus: string | null; normalizedLabel: string; orderCreatedAt: string | null; trackingNumber: string | null;
  shippingOption: string | null; shippingMethod: string | null; city: string | null; uf: string | null; returnRefundStatus: string | null;
  itemsSubtotal: string | null; totalAmount: string | null; marketplaceFeesTotal: string | null; productCostTotal: string | null;
  estimatedResult: string | null; estimatedMarginPct: string | null; costPending: boolean; commissionNet: string | null; serviceFeeNet: string | null; transactionFee: string | null;
  items: OrderDetailItem[]; statusHistory: { field: string; oldValue: string | null; newValue: string | null; observedAt: string }[];
  occurrences: { id: string; type: string; status: string | null; requestedRefundAmount: string | null }[];
}
interface OrderDetailItem {
  id: string; sku: string | null; productName: string | null; variationName: string | null; quantity: number; agreedPrice: string | null;
  productSubtotal: string | null; skuLinked: boolean; costUnit: string | null; costTotal: string | null; costMissing: boolean;
  allocatedFees: string | null; estimatedResult: string | null; estimatedMarginPct: string | null;
  productVariation: { family: { name: string } | null } | null;
}

function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const o = useJson<OrderDetail>(`/orders/${id}`);
  const card = (l: string, v: string, cls = '') => <div className={`kpi ${cls}`}><div className="lbl">{l}</div><div className="val">{v}</div></div>;
  return (
    <div className="drawer" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer-panel" style={{ width: 900, maxWidth: '96vw' }}>
        <div className="dh"><div><b>Pedido {o?.externalOrderId ?? id}</b><div className="footnote" style={{ margin: 0 }}>Shopee · lidermolduras {o?.orderCreatedAt ? '· ' + dateBR(o.orderCreatedAt).split(' ')[0] : ''}</div></div><button className="x" onClick={onClose}>×</button></div>
        <div className="dbd">
          {!o ? <div className="empty">Carregando…</div> : (<>
            <div className="kpi-grid">
              {card('Venda real', brl(o.itemsSubtotal))}
              {card('Valor Total', brl(o.totalAmount))}
              {card('Taxas marketplace', brl(o.marketplaceFeesTotal))}
              {card('Custo produtos', o.costPending ? '—' : brl(o.productCostTotal))}
              {card('Lucro estimado', o.estimatedResult == null ? 'pendente' : brl(o.estimatedResult))}
              {card('Margem', pctv(o.estimatedMarginPct))}
            </div>
            <div className="panel"><div className="ph"><h3>Itens do pedido ({o.items.length})</h3></div><div className="pb">
              {o.items.map((it) => (
                <div className="ro" key={it.id} style={{ marginBottom: 8 }}>
                  <b>{it.productName ?? '—'}</b>{it.variationName ? ' · ' + it.variationName : ''}
                  <div className="footnote">SKU <span className="mono">{it.sku ?? '—'}</span> · qtd {it.quantity} · {it.productVariation?.family?.name ? `família ${it.productVariation.family.name}` : (it.skuLinked ? 'sem família' : 'SKU não vinculado')}</div>
                  <div className="fin-line"><span>Preço acordado (venda real)</span><span>{brl(it.agreedPrice)}</span></div>
                  <div className="fin-line"><span>Subtotal</span><span>{brl(it.productSubtotal)}</span></div>
                  <div className="fin-line"><span>Taxas rateadas <span className="tag">rateada</span></span><span className="neg">-{brl(it.allocatedFees)}</span></div>
                  <div className="fin-line"><span>Custo</span><span>{it.costTotal == null ? (it.skuLinked ? <span className="tag warn">custo não cadastrado</span> : <span className="tag warn">SKU não vinculado</span>) : `${brl(it.costUnit)} × ${it.quantity} = ${brl(it.costTotal)}`}</span></div>
                  <div className="fin-line total"><span>Lucro estimado</span><span>{it.estimatedResult == null ? <span className="tag warn">pendente</span> : <b style={{ color: 'var(--ok)' }}>{brl(it.estimatedResult)}</b>}</span></div>
                </div>
              ))}
            </div></div>
            <div className="panel"><div className="ph"><h3>Composição financeira</h3></div><div className="pb">
              <div className="fin-line"><span>Venda real (Σ preço acordado)</span><span>{brl(o.itemsSubtotal)}</span></div>
              <div className="fin-line"><span>Valor Total (Shopee)</span><span>{brl(o.totalAmount)}</span></div>
              <div className="fin-line"><span>Comissão líquida</span><span className="neg">-{brl(o.commissionNet)}</span></div>
              <div className="fin-line"><span>Taxa de serviço líquida</span><span className="neg">-{brl(o.serviceFeeNet)}</span></div>
              <div className="fin-line"><span>Taxa de transação</span><span className="neg">-{brl(o.transactionFee)}</span></div>
              <div className="fin-line"><span>Custo produtos</span><span>{o.costPending ? <span className="tag warn">pendente</span> : <span className="neg">-{brl(o.productCostTotal)}</span>}</span></div>
              <div className="fin-line total"><span>Resultado estimado</span><span style={{ color: 'var(--ok)' }}>{o.estimatedResult == null ? 'pendente (custo)' : brl(o.estimatedResult)}</span></div>
            </div></div>
            <div className="panel"><div className="ph"><h3>Logística & cliente</h3></div><div className="pb">
              <label className="fld">Status Shopee</label><div className="ro">{o.orderStatus ?? '—'}</div>
              <label className="fld">Rastreamento</label><div className="ro">{o.trackingNumber ?? '—'}</div>
              <label className="fld">Envio</label><div className="ro">{[o.shippingOption, o.shippingMethod].filter(Boolean).join(' · ') || '—'}</div>
              <label className="fld">Cidade / UF</label><div className="ro">{(o.city ?? '—') + ' / ' + (o.uf ?? '—')}</div>
            </div></div>
            {o.occurrences.length > 0 && (
              <div className="panel"><div className="ph"><h3>Devoluções vinculadas</h3></div><div className="pb">
                {o.occurrences.map((x) => <div className="ro" key={x.id} style={{ marginBottom: 6 }}>{x.type} · {x.status ?? '—'} · {brl(x.requestedRefundAmount)}</div>)}
              </div></div>
            )}
            {o.statusHistory.length > 0 && (
              <div className="panel"><div className="ph"><h3>Histórico</h3></div><div className="pb">
                {o.statusHistory.map((h, i) => <div className="fin-line" key={i}><span>{h.field}: {h.oldValue ?? '∅'} → {h.newValue ?? '∅'}</span><span className="footnote" style={{ margin: 0 }}>{dateBR(h.observedAt)}</span></div>)}
              </div></div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}
