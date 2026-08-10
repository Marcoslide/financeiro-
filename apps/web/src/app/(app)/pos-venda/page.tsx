'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { dateBR } from '@/lib/format';

interface Account { id: string; displayName: string }
const brl = (v: string | number | null | undefined) =>
  v == null ? 'R$ 0,00' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nn = (n: number) => n.toLocaleString('pt-BR');

const TYPE_LABEL: Record<string, string> = {
  RETURN_REFUND: 'Devoluções / Reembolsos', ORDER_CANCELLATION: 'Cancelamentos', FAILED_DELIVERY: 'Falhas de Entrega',
};
const TABS = ['visao', 'ocorrencias', 'exposicao', 'saude', 'importacoes'] as const;
const TAB_LABEL: Record<string, string> = {
  visao: 'Visão Geral', ocorrencias: 'Ocorrências', exposicao: 'Exposição Financeira', saude: 'Saúde dos Dados', importacoes: 'Importações',
};

function periodRange(preset: string, custom: { from: string; to: string }): { from?: string; to?: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (preset === 'all') return {};
  if (preset === 'custom') return { from: custom.from || undefined, to: custom.to || undefined };
  if (preset === 'today') return { from: iso(startOf(now)) };
  if (preset === '7d') return { from: iso(new Date(now.getTime() - 7 * 864e5)) };
  if (preset === '30d') return { from: iso(new Date(now.getTime() - 30 * 864e5)) };
  if (preset === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  if (preset === 'prevmonth') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  return {};
}

export default function PosVendaPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'FINANCIAL';
  const [account, setAccount] = useState<Account | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('visao');
  const [preset, setPreset] = useState('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [toast, setToast] = useState<{ title: string; body: string; err?: boolean } | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  useEffect(() => { api.get<Account[]>('/marketplace-accounts').then((a) => setAccount(a[0] ?? null)); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const qp = useCallback(() => {
    const r = periodRange(preset, custom);
    const p = new URLSearchParams({ marketplaceAccountId: account!.id });
    if (r.from) p.set('from', r.from); if (r.to) p.set('to', r.to);
    return p;
  }, [account, preset, custom]);

  return (
    <>
      <div className="page-head">
        <div><h2>Pós-venda &amp; Perdas</h2><p>Devoluções, reembolsos, cancelamentos e falhas de entrega — exposição, causas e ações.</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="select sm" value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="all">Todo o período</option>
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="month">Mês atual</option>
            <option value="prevmonth">Mês anterior</option>
            <option value="custom">Personalizado</option>
          </select>
          {preset === 'custom' && (
            <>
              <input type="date" className="input sm" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <input type="date" className="input sm" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}</div>)}
      </div>

      {account && tab === 'visao' && <Visao qp={qp} />}
      {account && tab === 'ocorrencias' && <Ocorrencias qp={qp} onOpen={setDetail} />}
      {account && tab === 'exposicao' && <Exposicao qp={qp} />}
      {account && tab === 'saude' && <Saude accountId={account.id} />}
      {account && tab === 'importacoes' && (
        <Importacoes accountId={account.id} canEdit={canEdit} onDone={(m) => setToast(m)} />
      )}

      {detail && <OccurrenceDrawer id={detail} onClose={() => setDetail(null)} />}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}><div className="tt">{toast.title}</div><div>{toast.body}</div></div>}
    </>
  );
}

function useJson<T>(url: string | null): T | null {
  const [d, setD] = useState<T | null>(null);
  useEffect(() => { setD(null); if (url) api.get<T>(url).then(setD).catch(() => setD(null)); }, [url]);
  return d;
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return <div className="kpi"><div className="lbl">{label}</div><div className="val" style={warn ? { color: 'var(--warn)' } : undefined}>{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}

function Visao({ qp }: { qp: () => URLSearchParams }) {
  const ov = useJson<any>(`/post-sale/overview?${qp().toString()}`);
  const fnd = useJson<any>(`/post-sale/findings?${qp().toString()}`);
  if (!ov) return <div className="empty">Carregando…</div>;
  const e = ov.exposure;
  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Ocorrências" value={nn(ov.totalOccurrences)} sub={`${nn(ov.distinctOrders)} pedidos`} />
        <Kpi label="Devoluções" value={nn(ov.byType?.RETURN_REFUND ?? 0)} />
        <Kpi label="Cancelamentos" value={nn(ov.byType?.ORDER_CANCELLATION ?? 0)} />
        <Kpi label="Falhas de entrega" value={nn(ov.byType?.FAILED_DELIVERY ?? 0)} />
      </div>
      <div className="kpi-grid">
        <Kpi label="Prejuízo confirmado" value={brl(e.confirmedLoss)} warn />
        <Kpi label="Em risco" value={brl(e.atRisk)} />
        <Kpi label="Recuperado (compensação)" value={brl(e.recovered)} />
        <Kpi label="SKUs sem vínculo" value={nn(ov.unlinkedItems)} sub="itens sem produto no catálogo" warn />
      </div>
      <div className="panel">
        <div className="ph"><h3>Achados (determinísticos)</h3><span className="footnote" style={{ margin: 0 }}>amostra: {fnd?.sampleSize ?? 0}</span></div>
        <div className="pb">
          {(!fnd || !fnd.findings?.length) ? <div className="footnote" style={{ marginTop: 0 }}>Sem achados relevantes no período (ou amostra insuficiente).</div> :
            fnd.findings.map((f: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                <span className={`badge ${f.type === 'CRITICAL' ? 'b-err' : f.type === 'ATTENTION' ? 'b-warn' : 'b-info'}`}>{f.type}</span>
                <div><b>{f.title}</b><div className="footnote" style={{ margin: 0 }}>{f.description} · confiança {f.confidence}</div></div>
              </div>
            ))}
        </div>
      </div>
      <div className="panel">
        <div className="ph"><h3>Top SKUs por ocorrência</h3></div>
        <div className="pb" style={{ padding: 0 }}>
          <div className="table-wrap"><table><thead><tr><th>SKU</th><th>Produto</th><th>Ocorrências</th><th>Perda confirmada</th></tr></thead>
            <tbody>{(fnd?.topSkus ?? []).map((s: any) => (
              <tr key={s.sku}><td className="mono">{s.sku}</td><td>{s.product ?? '—'}</td><td>{s.occ}</td><td>{brl(s.loss)}</td></tr>
            ))}{(!fnd?.topSkus?.length) && <tr><td colSpan={4} className="empty">Sem dados.</td></tr>}</tbody>
          </table></div>
        </div>
      </div>
      <div className="footnote">Metodologia da exposição: {ov.methodology}</div>
    </>
  );
}

function Exposicao({ qp }: { qp: () => URLSearchParams }) {
  const e = useJson<any>(`/post-sale/exposure?${qp().toString()}`);
  if (!e) return <div className="empty">Carregando…</div>;
  const rows: [string, string, boolean?][] = [
    ['Valor solicitado', brl(e.requested)], ['Prejuízo confirmado', brl(e.confirmedLoss), true], ['Em risco', brl(e.atRisk)],
    ['Recuperado', brl(e.recovered)], ['Compensações', brl(e.compensation)], ['Solicitação cancelada/desistida', brl(e.cancelled)],
    ['Potencialmente recuperável', brl(e.potentiallyRecoverable)], ['Sem classificação segura', brl(e.unclassified)],
  ];
  return (
    <div className="panel">
      <div className="ph"><h3>Exposição financeira</h3></div>
      <div className="pb" style={{ padding: 0 }}>
        <div className="table-wrap"><table><tbody>
          {rows.map(([l, v, w]) => <tr key={l}><td>{l}</td><td style={{ textAlign: 'right', fontWeight: 700, color: w ? 'var(--err)' : undefined }}>{v}</td></tr>)}
        </tbody></table></div>
      </div>
      <div className="pb footnote">{e.methodology}<br />Valor solicitado nunca é tratado automaticamente como prejuízo (§21).</div>
    </div>
  );
}

function Saude({ accountId }: { accountId: string }) {
  const c = useJson<any>(`/post-sale/coverage?marketplaceAccountId=${accountId}`);
  if (!c) return <div className="empty">Carregando…</div>;
  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Itens com SKU" value={`${c.dataHealth.withSkuPct}%`} />
        <Kpi label="Itens vinculados ao catálogo" value={`${c.dataHealth.linkedPct}%`} warn={c.dataHealth.linkedPct < 50} />
        <Kpi label="Itens sem vínculo" value={nn(c.dataHealth.unlinkedItems)} warn />
      </div>
      <div className="panel"><div className="ph"><h3>Cobertura por relatório</h3></div>
        <div className="pb" style={{ padding: 0 }}><div className="table-wrap"><table>
          <thead><tr><th>Relatório</th><th>Ocorrências</th><th>Período coberto</th></tr></thead>
          <tbody>{c.perType.map((t: any) => (
            <tr key={t.type}><td>{t.label}</td><td>{nn(t.count)}</td>
              <td>{t.periodStart ? `${dateBR(t.periodStart)} — ${dateBR(t.periodEnd)}` : <span className="tag warn">sem dados</span>}</td></tr>
          ))}</tbody></table></div></div>
      </div>
      <div className="footnote">Taxas por coorte de venda dependem da base de Pedidos/Vendas (módulo em construção). Enquanto isso, mostramos volumes absolutos, não taxas (§35/§96).</div>
    </>
  );
}

function Ocorrencias({ qp, onOpen }: { qp: () => URLSearchParams; onOpen: (id: string) => void }) {
  const [type, setType] = useState(''); const [status, setStatus] = useState(''); const [search, setSearch] = useState('');
  const [linked, setLinked] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState<any | null>(null);
  const load = useCallback(() => {
    const p = qp(); if (type) p.set('type', type); if (status) p.set('status', status); if (search) p.set('search', search); if (linked) p.set('linked', linked); p.set('page', String(page));
    api.get<any>(`/post-sale/occurrences?${p.toString()}`).then(setData);
  }, [qp, type, status, search, linked, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="panel">
      <div className="pb">
        <div className="toolbar2">
          <input className="input sm" style={{ width: 240 }} placeholder="Buscar pedido, devolução, SKU…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <select className="select sm" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">Tipo: todos</option><option value="RETURN_REFUND">Devoluções</option><option value="ORDER_CANCELLATION">Cancelamentos</option><option value="FAILED_DELIVERY">Falhas</option></select>
          <input className="input sm" style={{ width: 150 }} placeholder="Status contém…" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
          <select className="select sm" value={linked} onChange={(e) => { setLinked(e.target.value); setPage(1); }}><option value="">Vínculo: todos</option><option value="linked">SKU vinculado</option><option value="unlinked">SKU não vinculado</option></select>
        </div>
        <div className="count-line"><b>{data ? nn(data.total) : '…'}</b> ocorrências</div>
      </div>
      <div className="pb" style={{ padding: 0 }}>
        {!data ? <div className="empty">Carregando…</div> : data.items.length === 0 ? <div className="empty">Nenhuma ocorrência no período/filtros.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Tipo</th><th>Pedido</th><th>ID Devolução</th><th>Status</th><th>Itens</th><th>Reembolso</th><th>Exposição</th><th></th></tr></thead>
            <tbody>{data.items.map((o: any) => (
              <tr key={o.id}>
                <td><span className="tag info">{TYPE_LABEL[o.type]?.split(' ')[0] ?? o.type}</span></td>
                <td className="mono">{o.externalOrderId}</td>
                <td className="mono">{o.externalReturnId ?? '—'}</td>
                <td>{o.status ?? '—'}</td>
                <td>{o.itemCount}{o.itemCount > 1 && <span className="tag" style={{ marginLeft: 4 }}>multi-SKU</span>}</td>
                <td>{brl(o.requestedRefundAmount)}</td>
                <td><span className={`tag ${o.exposureBucket === 'CONFIRMED' ? 'warn' : o.exposureBucket === 'AT_RISK' ? 'info' : 'ok'}`}>{o.exposureBucket}</span></td>
                <td><button className="btn-sm" onClick={() => onOpen(o.id)}>Abrir</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {pages > 1 && <div className="pb" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        <button className="btn-sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Anterior</button>
        <span className="footnote" style={{ margin: 0 }}>página {page} de {pages}</span>
        <button className="btn-sm" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>Próxima</button>
      </div>}
    </div>
  );
}

function OccurrenceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const o = useJson<any>(`/post-sale/occurrences/${id}`);
  return (
    <div className="drawer" onClick={onClose}>
      <div className="drawer-panel" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="dh"><h3 style={{ margin: 0, fontSize: 16 }}>Ficha da ocorrência</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="dbd">
          {!o ? 'Carregando…' : (<>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label className="fld">Tipo</label><div className="ro">{TYPE_LABEL[o.type] ?? o.type}</div></div>
              <div><label className="fld">Status</label><div className="ro">{o.status ?? '—'}</div></div>
              <div><label className="fld">Pedido</label><div className="ro mono">{o.externalOrderId}</div></div>
              <div><label className="fld">ID Devolução</label><div className="ro mono">{o.externalReturnId ?? '—'}</div></div>
              <div><label className="fld">Reembolso solicitado</label><div className="ro">{brl(o.requestedRefundAmount)}</div></div>
              <div><label className="fld">Compensação</label><div className="ro">{brl(o.sellerCompensationAmount)}</div></div>
            </div>
            <label className="fld">Exposição</label><div className="ro">{o.exposure?.bucket} · confirmado {brl(o.exposure?.confirmedLoss)} · risco {brl(o.exposure?.atRisk)}</div>
            <label className="fld">Motivo / Solução</label><div className="ro">{o.reason ?? '—'}{o.resolution ? ` · ${o.resolution}` : ''}</div>
            <label className="fld">Itens ({o.items?.length})</label>
            <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 10 }}><table>
              <thead><tr><th>SKU</th><th>Produto/Variação</th><th>Qtd</th><th>Catálogo</th></tr></thead>
              <tbody>{o.items?.map((it: any) => (
                <tr key={it.id}><td className="mono">{it.sku ?? '—'}</td><td>{it.productName ?? '—'}{it.variationName ? ` · ${it.variationName}` : ''}</td><td>{it.quantity ?? '—'}</td>
                  <td>{it.skuLinked ? <span className="tag ok">vinculado</span> : <span className="tag warn">não vinculado</span>}</td></tr>
              ))}</tbody></table></div>
            {o.statusHistory?.length > 0 && <>
              <label className="fld">Histórico de status</label>
              <div className="ro">{o.statusHistory.map((h: any, i: number) => <div key={i}>{dateBR(h.observedAt)}: {h.previousStatus ?? '—'} → {h.newStatus ?? '—'}</div>)}</div>
            </>}
          </>)}
        </div>
      </div>
    </div>
  );
}

function Importacoes({ accountId, canEdit, onDone }: { accountId: string; canEdit: boolean; onDone: (m: { title: string; body: string; err?: boolean }) => void }) {
  const [batches, setBatches] = useState<any[]>([]);
  const load = useCallback(() => { api.get<any[]>(`/post-sale/import-batches?marketplaceAccountId=${accountId}`).then(setBatches); }, [accountId]);
  useEffect(() => { load(); }, [load]);
  const types: [string, string][] = [['RETURN_REFUND', 'Devoluções / Reembolsos'], ['ORDER_CANCELLATION', 'Cancelamentos'], ['FAILED_DELIVERY', 'Falhas de Entrega']];
  return (
    <>
      {canEdit && <div className="kpi-grid">
        {types.map(([t, l]) => <ImporterCard key={t} accountId={accountId} type={t} label={l} onDone={(m) => { onDone(m); load(); }} />)}
      </div>}
      <div className="panel"><div className="ph"><h3>Histórico de importações</h3><span className="footnote" style={{ margin: 0 }}>{batches.length}</span></div>
        <div className="pb" style={{ padding: 0 }}>{batches.length === 0 ? <div className="empty">Nenhuma importação ainda.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Relatório</th><th>Arquivo</th><th>Ocorrências</th><th>Novas</th><th>Atualizadas</th><th>Itens</th><th>Erros</th><th>Período</th><th>Data</th></tr></thead>
            <tbody>{batches.map((b) => (
              <tr key={b.id}><td>{TYPE_LABEL[b.occurrenceType]}</td><td><div style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.originalFilename}</div></td>
                <td>{b.occurrencesSeen}</td><td>{b.newOccurrences}</td><td>{b.updatedOccurrences}</td><td>{b.itemsSeen}</td>
                <td>{b.errorRows > 0 ? <b style={{ color: 'var(--err)' }}>{b.errorRows}</b> : 0}</td>
                <td className="footnote" style={{ margin: 0 }}>{b.periodStart ? `${dateBR(b.periodStart)}—${dateBR(b.periodEnd)}` : '—'}</td>
                <td className="footnote" style={{ margin: 0 }}>{dateBR(b.createdAt)}</td></tr>
            ))}</tbody></table></div>
        )}</div>
      </div>
    </>
  );
}

function ImporterCard({ accountId, type, label, onDone }: { accountId: string; type: string; label: string; onDone: (m: { title: string; body: string; err?: boolean }) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  async function up(f: File) {
    setLoading(true);
    try {
      const form = new FormData(); form.append('marketplaceAccountId', accountId); form.append('type', type); form.append('file', f);
      const r = await api.upload<any>('/post-sale/import', form);
      onDone({ title: `Importação: ${label}`, body: `${r.occurrencesSeen} ocorrências · ${r.newOccurrences} novas · ${r.updatedOccurrences} atualizadas · ${r.itemsSeen} itens · ${r.errorRows} erros`, err: r.errorRows > 0 });
    } catch (e) { onDone({ title: 'Falha na importação', body: e instanceof Error ? e.message : 'erro', err: true }); }
    finally { setLoading(false); }
  }
  return (
    <div className="kpi">
      <div className="lbl">{label}</div>
      <button className="btn-sm primary" style={{ marginTop: 10 }} disabled={loading} onClick={() => ref.current?.click()}>{loading ? 'Importando…' : 'Importar planilha'}</button>
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) up(f); e.target.value = ''; }} />
    </div>
  );
}
