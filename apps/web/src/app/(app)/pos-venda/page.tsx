'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { dateBR } from '@/lib/format';

interface Account { id: string; displayName: string }
const brl = (v: string | number | null | undefined) => v == null ? 'R$ 0,00' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nn = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR');
const pctv = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR') + '%';

const INTERNAL_STATUS: Record<string, string> = { NOVA: 'Nova', ANALISE: 'Em análise', AGUARDANDO_EVIDENCIA: 'Aguardando evidência', AGUARDANDO_RETORNO: 'Aguardando retorno', EM_TRANSITO: 'Produto em trânsito', RECEBIDO: 'Produto recebido', EM_DISPUTA: 'Em disputa', AGUARDANDO_RESULTADO: 'Aguardando resultado', RESOLVIDA: 'Resolvida', ENCERRADA: 'Encerrada', EXIGE_ACAO: 'Exige ação' };
const PRIORITY: Record<string, string> = { BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta', URGENTE: 'Urgente' };
const RESPONSIBILITY: Record<string, string> = { OPERACAO: 'Nossa operação', SHOPEE: 'Shopee', LOGISTICA: 'Transportadora / logística', COMPRADOR: 'Comprador', COMPARTILHADA: 'Compartilhada', NAO_IDENTIFICADA: 'Não identificada' };
const MERCH_STATUS: Record<string, string> = { DESCONHECIDO: 'Não sabemos', CLIENTE_POSSUI: 'Cliente ainda possui', RETORNO_DISPENSADO: 'Retorno dispensado', AGUARDANDO_POSTAGEM: 'Aguardando postagem', EM_TRANSITO: 'Em trânsito', RECEBIDO: 'Recebido', EXTRAVIADO: 'Extraviado', PERDIDO: 'Perdido' };
const MERCH_COND: Record<string, string> = { REAPROVEITAVEL: 'Reaproveitável', REQUER_RETRABALHO: 'Requer retrabalho', AVARIADO: 'Avariado', PERDA_TOTAL: 'Perda total' };
const DISPUTE_STATUS: Record<string, string> = { NAO_INICIADA: 'Não iniciada', POSSIVEL: 'Possível contestação', EM_PREPARACAO: 'Em preparação', RESPONDIDA: 'Respondida', AGUARDANDO_SHOPEE: 'Aguardando Shopee', GANHA: 'Ganha', PARCIAL: 'Parcialmente ganha', PERDIDA: 'Perdida', PRAZO_PERDIDO: 'Prazo perdido', CANCELADA: 'Cancelada' };
const EVENT_TYPES: Record<string, string> = { REEMBOLSO_PAGO: 'Reembolso pago', FRETE_REVERSO: 'Frete reverso', FRETE_ADICIONAL: 'Frete adicional', CUSTO_RETRABALHO: 'Custo de retrabalho', COMPENSACAO_SHOPEE: 'Compensação Shopee', RECUPERACAO_DISPUTA: 'Recuperação de disputa', PRODUTO_RECUPERADO: 'Produto recuperado', PRODUTO_PERDIDO: 'Produto perdido', AJUSTE_MANUAL: 'Ajuste manual', OUTRO: 'Outro' };

const SUBTABS = [
  ['visao', 'Visão Geral'], ['ocorrencias', 'Ocorrências'], ['motivos', 'Motivos'], ['causas', 'Causas'], ['produtos', 'Produtos & SKUs'],
  ['financeiro', 'Financeiro'], ['disputas', 'Disputas'], ['achados', 'Achados'], ['pendencias', 'Pendências'], ['planos', 'Plano de Ação'],
  ['saude', 'Saúde dos Dados'], ['importacoes', 'Importações'],
] as const;

function periodRange(preset: string): { from?: string; to?: string } {
  const now = new Date(); const iso = (d: Date) => d.toISOString();
  if (preset === '30d') return { from: iso(new Date(now.getTime() - 30 * 864e5)) };
  if (preset === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  if (preset === 'prevmonth') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  return {};
}

function useJson<T>(url: string | null, dep?: unknown): T | null {
  const [d, setD] = useState<T | null>(null);
  useEffect(() => { setD(null); if (url) api.get<T>(url).then(setD).catch(() => setD(null)); }, [url, dep]);
  return d;
}

export default function DevolucaoPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'FINANCIAL';
  const [account, setAccount] = useState<Account | null>(null);
  const [tab, setTab] = useState('visao');
  const [preset, setPreset] = useState('all');
  const [detail, setDetail] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { api.get<Account[]>('/marketplace-accounts').then((a) => setAccount(a[0] ?? null)); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  const qp = useCallback(() => {
    const r = periodRange(preset); const p = new URLSearchParams({ marketplaceAccountId: account!.id });
    if (r.from) p.set('from', r.from); if (r.to) p.set('to', r.to);
    return p;
  }, [account, preset]);

  return (
    <>
      <div className="page-head">
        <div><h2>Devolução</h2><p>Operação, controle financeiro, investigação e inteligência — devoluções, reembolsos, cancelamentos e falhas de entrega.</p></div>
        <select className="select sm" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="all">Todo o período</option><option value="30d">Últimos 30 dias</option><option value="month">Mês atual</option><option value="prevmonth">Mês anterior</option>
        </select>
      </div>
      <div className="tabs">
        {SUBTABS.map(([k, l]) => <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</div>)}
      </div>
      {account && tab === 'visao' && <Visao qp={qp} go={setTab} onOpen={setDetail} k={refreshKey} />}
      {account && tab === 'ocorrencias' && <Ocorrencias qp={qp} onOpen={setDetail} k={refreshKey} />}
      {account && tab === 'motivos' && <Motivos qp={qp} k={refreshKey} />}
      {account && tab === 'causas' && <Causas qp={qp} k={refreshKey} />}
      {account && tab === 'produtos' && <Criticos qp={qp} k={refreshKey} />}
      {account && tab === 'financeiro' && <Financeiro qp={qp} k={refreshKey} />}
      {account && tab === 'disputas' && <Disputas qp={qp} k={refreshKey} />}
      {account && tab === 'achados' && <Achados qp={qp} accountId={account.id} canEdit={canEdit} onCreated={() => setRefreshKey((x) => x + 1)} k={refreshKey} />}
      {account && tab === 'pendencias' && <Pendencias accountId={account.id} go={setTab} k={refreshKey} />}
      {account && tab === 'planos' && <Planos accountId={account.id} canEdit={canEdit} k={refreshKey} />}
      {account && tab === 'saude' && <Saude accountId={account.id} />}
      {account && tab === 'importacoes' && <Importacoes accountId={account.id} canEdit={canEdit} onDone={(m) => { setToast(m); setRefreshKey((x) => x + 1); }} />}
      {detail && <FichaDrawer id={detail} canEdit={canEdit} onClose={() => setDetail(null)} onChange={() => setRefreshKey((x) => x + 1)} />}
      {toast && <div className="toast"><div className="tt">Devolução</div><div>{toast}</div></div>}
    </>
  );
}

const card = (l: string, v: string, cls = '', sub = '') => <div className={`kpi ${cls}`}><div className="lbl">{l}</div><div className="val">{v}</div>{sub && <div className="footnote" style={{ marginTop: 4 }}>{sub}</div>}</div>;

interface Overview {
  indicators: { totalOccurrences: number; orders: number; returnRate: number | null; lossOverRevenue: number | null; confirmedLoss: number; atRisk: number; recovered: number; compensation: number; additionalCost: number; productWithoutReturn: number; disputesOpen: number; disputesDueSoon: number; disputeResponseRate: number };
  whereIsTheError: { key: string; label: string; cases: number; loss: number; atRisk: number; shareOfLoss: number }[];
  criticalProducts: { sku: string; product: string | null; occurrences: number; loss: number; dominantCause: string; shareOfLoss: number }[];
  topReasons: { reason: string; cases: number; loss: number; giveupRate: number }[];
  disputes: { possiveis: number; abertas: number; vencendo: number; vencidas: number; respondidas: number; ganhas: number; perdidas: number; taxaResposta: number; valorContestado: number; valorRecuperado: number };
  pendingQueue: { key: string; label: string; count: number }[];
}

function Visao({ qp, go, onOpen, k }: { qp: () => URLSearchParams; go: (t: string) => void; onOpen: (id: string) => void; k: number }) {
  const d = useJson<Overview>(`/post-sale/exec-overview?${qp().toString()}`, k);
  if (!d) return <div className="panel"><div className="empty">Carregando…</div></div>;
  const i = d.indicators;
  return (
    <>
      <div className="kpi-grid">
        {card('Taxa de devolução', pctv(i.returnRate), '', `${nn(i.totalOccurrences)} ocorrências / ${nn(i.orders)} pedidos`)}
        {card('Perda sobre faturamento', pctv(i.lossOverRevenue))}
        {card('Perda confirmada', brl(i.confirmedLoss))}
        {card('Em risco', brl(i.atRisk))}
        {card('Recuperado', brl(i.recovered))}
        {card('Custos adicionais', brl(i.additionalCost), '', 'frete reverso, retrabalho…')}
        {card('Produto sem retorno', nn(i.productWithoutReturn))}
        {card('Disputas abertas', nn(i.disputesOpen), '', `${i.disputesDueSoon} vencendo · resposta ${pctv(i.disputeResponseRate)}`)}
      </div>

      <div className="panel"><div className="ph"><h3>Onde está o erro</h3><button className="link-btn" onClick={() => go('motivos')}>Analisar motivos</button></div>
        <div className="table-wrap"><table><thead><tr><th>Causa</th><th>Casos</th><th>Perda</th><th>Em risco</th><th>% da perda</th></tr></thead><tbody>
          {d.whereIsTheError.length ? d.whereIsTheError.map((c) => (
            <tr key={c.key}><td><b>{c.label}</b></td><td>{nn(c.cases)}</td><td>{brl(c.loss)}</td><td>{brl(c.atRisk)}</td><td><span className="tag">{pctv(c.shareOfLoss)}</span></td></tr>
          )) : <tr><td colSpan={5} className="empty">Sem dados no período.</td></tr>}
        </tbody></table></div>
      </div>

      <div className="split2">
        <div className="panel"><div className="ph"><h3>Produtos críticos</h3><button className="link-btn" onClick={() => go('produtos')}>Ver todos</button></div>
          <div className="table-wrap"><table><thead><tr><th>SKU</th><th>Ocor.</th><th>Perda</th><th>Causa</th></tr></thead><tbody>
            {d.criticalProducts.length ? d.criticalProducts.map((s) => <tr key={s.sku}><td className="mono">{s.sku}</td><td>{s.occurrences}</td><td>{brl(s.loss)}</td><td>{s.dominantCause}</td></tr>) : <tr><td colSpan={4} className="empty">—</td></tr>}
          </tbody></table></div>
        </div>
        <div className="panel"><div className="ph"><h3>Defesa / Disputas</h3><button className="link-btn" onClick={() => go('disputas')}>Abrir disputas</button></div><div className="pb">
          <div className="fin-line"><span>Abertas</span><b>{nn(d.disputes.abertas)}</b></div>
          <div className="fin-line"><span>Vencendo (≤3 dias)</span><b style={{ color: d.disputes.vencendo ? 'var(--warn)' : undefined }}>{nn(d.disputes.vencendo)}</b></div>
          <div className="fin-line"><span>Vencidas</span><b style={{ color: d.disputes.vencidas ? 'var(--err)' : undefined }}>{nn(d.disputes.vencidas)}</b></div>
          <div className="fin-line"><span>Taxa de resposta</span><b>{pctv(d.disputes.taxaResposta)}</b></div>
          <div className="fin-line"><span>Ganhas / Perdidas</span><b>{nn(d.disputes.ganhas)} / {nn(d.disputes.perdidas)}</b></div>
          <div className="fin-line total"><span>Valor recuperado</span><span className="pos">{brl(d.disputes.valorRecuperado)}</span></div>
        </div></div>
      </div>

      <div className="panel"><div className="ph"><h3>Atenção necessária</h3><button className="link-btn" onClick={() => go('pendencias')}>Fila operacional</button></div><div className="pb">
        {d.pendingQueue.length ? d.pendingQueue.map((p) => <div className="fin-line" key={p.key}><span>{p.label}</span><b>{nn(p.count)}</b></div>) : <div className="footnote">Nada pendente. 🎉</div>}
      </div></div>
    </>
  );
}

interface OccRow { id: string; type: string; externalOrderId: string; status: string | null; reason: string | null; occurredAt: string | null; itemCount: number; requestedRefundAmount: string | null; exposureBucket: string; internalStatus: string; priority: string; ownerName: string | null; responsibility: string; disputeStatus: string; knownNetImpact: string | null; items: { sku: string | null }[] }

function Ocorrencias({ qp, onOpen, k }: { qp: () => URLSearchParams; onOpen: (id: string) => void; k: number }) {
  const [f, setF] = useState({ search: '', internalStatus: '', responsibility: '', disputeStatus: '', sort: 'recent' });
  const [page, setPage] = useState(1);
  const p = qp(); Object.entries(f).forEach(([kk, v]) => { if (v) p.set(kk === 'sort' ? 'sort' : kk, kk === 'sort' ? (v === 'impact' ? 'impact_desc' : 'recent') : v); }); p.set('page', String(page)); p.set('pageSize', '25');
  const data = useJson<{ total: number; page: number; pageSize: number; items: OccRow[] }>(`/post-sale/occurrences?${p.toString()}`, k);
  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;
  return (
    <>
      <div className="toolbar2">
        <input className="input sm" style={{ width: 240 }} placeholder="Buscar pedido, SKU, produto…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} />
        <select className="select sm" value={f.internalStatus} onChange={(e) => { setF({ ...f, internalStatus: e.target.value }); setPage(1); }}><option value="">Status interno: todos</option>{Object.entries(INTERNAL_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="select sm" value={f.responsibility} onChange={(e) => { setF({ ...f, responsibility: e.target.value }); setPage(1); }}><option value="">Responsabilidade: todas</option>{Object.entries(RESPONSIBILITY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="select sm" value={f.disputeStatus} onChange={(e) => { setF({ ...f, disputeStatus: e.target.value }); setPage(1); }}><option value="">Disputa: todas</option>{Object.entries(DISPUTE_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="select sm" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}><option value="recent">Mais recentes</option><option value="impact">Maior impacto</option></select>
      </div>
      <div className="count-line"><b>{nn(data?.total)}</b> ocorrências</div>
      <div className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Pedido</th><th>Motivo</th><th>Status interno</th><th>Responsável</th><th>Disputa</th><th>Impacto líquido</th><th>Exposição</th><th></th></tr></thead>
        <tbody>{data?.items.length ? data.items.map((o) => (
          <tr key={o.id}>
            <td className="mono">{o.externalOrderId}<div className="footnote" style={{ margin: 0 }}>{o.items[0]?.sku ?? '—'}{o.itemCount > 1 ? ` +${o.itemCount - 1}` : ''}</div></td>
            <td>{(o.reason ?? '—').slice(0, 30)}</td>
            <td><span className="pill st-int">{INTERNAL_STATUS[o.internalStatus] ?? o.internalStatus}</span></td>
            <td>{o.ownerName ?? <span className="footnote">—</span>}</td>
            <td>{o.disputeStatus !== 'NAO_INICIADA' ? <span className="tag info">{DISPUTE_STATUS[o.disputeStatus]}</span> : <span className="footnote">—</span>}</td>
            <td>{o.knownNetImpact != null ? <b>{brl(o.knownNetImpact)}</b> : '—'}</td>
            <td><span className={`tag ${o.exposureBucket === 'CONFIRMED' ? 'warn' : o.exposureBucket === 'AT_RISK' ? 'info' : 'ok'}`}>{o.exposureBucket}</span></td>
            <td><button className="btn-sm" onClick={() => onOpen(o.id)}>Abrir ficha</button></td>
          </tr>
        )) : <tr><td colSpan={8} className="empty">{data ? 'Nenhuma ocorrência.' : 'Carregando…'}</td></tr>}</tbody>
      </table></div></div>
      {pages > 1 && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}><button className="btn-sm" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>Anterior</button><span className="footnote" style={{ margin: 0 }}>página {page} de {pages}</span><button className="btn-sm" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>Próxima</button></div>}
    </>
  );
}

function Motivos({ qp, k }: { qp: () => URLSearchParams; k: number }) {
  const d = useJson<{ reason: string; cases: number; approved: number; analyzing: number; giveups: number; giveupRate: number; loss: number; atRisk: number; compensation: number; avgTicket: number; returnedCount: number }[]>(`/post-sale/motivos?${qp().toString()}`, k);
  return <div className="panel"><div className="ph"><h3>Motivos, um a um</h3></div><div className="table-wrap"><table>
    <thead><tr><th>Motivo</th><th>Casos</th><th>Aprov.</th><th>Análise</th><th>Desist.</th><th>Taxa desist.</th><th>Perda</th><th>Em risco</th><th>Ticket médio</th><th>Compensação</th><th>Retornou</th></tr></thead>
    <tbody>{d ? (d.length ? d.map((r) => <tr key={r.reason}><td><b>{r.reason}</b></td><td>{nn(r.cases)}</td><td>{nn(r.approved)}</td><td>{nn(r.analyzing)}</td><td>{nn(r.giveups)}</td><td>{pctv(r.giveupRate)}</td><td>{brl(r.loss)}</td><td>{brl(r.atRisk)}</td><td>{brl(r.avgTicket)}</td><td>{brl(r.compensation)}</td><td>{nn(r.returnedCount)}</td></tr>) : <tr><td colSpan={11} className="empty">Sem dados.</td></tr>) : <tr><td colSpan={11} className="empty">Carregando…</td></tr>}</tbody>
  </table></div></div>;
}

function Criticos({ qp, k }: { qp: () => URLSearchParams; k: number }) {
  const d = useJson<{ sku: string; product: string | null; occurrences: number; loss: number; additionalCost: number; recovered: number; dominantCause: string; shareOfLoss: number; linked: boolean }[]>(`/post-sale/produtos-criticos?${qp().toString()}`, k);
  return <div className="panel"><div className="ph"><h3>Produtos & SKUs críticos</h3></div><div className="table-wrap"><table>
    <thead><tr><th>SKU</th><th>Produto</th><th>Ocor.</th><th>Perda</th><th>Custo adic.</th><th>Recuperado</th><th>% da perda</th><th>Causa dominante</th></tr></thead>
    <tbody>{d ? (d.length ? d.map((s) => <tr key={s.sku}><td className="mono">{s.sku}{!s.linked && <span className="tag warn" style={{ marginLeft: 6 }}>não vinculado</span>}</td><td>{(s.product ?? '—').slice(0, 40)}</td><td>{nn(s.occurrences)}</td><td><b>{brl(s.loss)}</b></td><td>{brl(s.additionalCost)}</td><td>{brl(s.recovered)}</td><td><span className="tag">{pctv(s.shareOfLoss)}</span></td><td>{s.dominantCause}</td></tr>) : <tr><td colSpan={8} className="empty">Sem dados.</td></tr>) : <tr><td colSpan={8} className="empty">Carregando…</td></tr>}</tbody>
  </table></div></div>;
}

function Causas({ qp, k }: { qp: () => URLSearchParams; k: number }) {
  const d = useJson<{ key: string; label: string; cases: number; loss: number; atRisk: number; additionalCost: number; recovered: number; netImpact: number; dominantReason: string; shareOfLoss: number }[]>(`/post-sale/causas?${qp().toString()}`, k);
  return <div className="panel"><div className="ph"><h3>Causas (interna ≠ motivo Shopee)</h3></div><div className="table-wrap"><table>
    <thead><tr><th>Causa</th><th>Casos</th><th>Perda</th><th>Custo adic.</th><th>Recuperado</th><th>Impacto líq.</th><th>Motivo dominante</th><th>% da perda</th></tr></thead>
    <tbody>{d ? (d.length ? d.map((c) => <tr key={c.key}><td><b>{c.label}</b></td><td>{nn(c.cases)}</td><td>{brl(c.loss)}</td><td>{brl(c.additionalCost)}</td><td>{brl(c.recovered)}</td><td><b>{brl(c.netImpact)}</b></td><td>{(c.dominantReason || '—').slice(0, 30)}</td><td><span className="tag">{pctv(c.shareOfLoss)}</span></td></tr>) : <tr><td colSpan={8} className="empty">Sem causas classificadas. Defina a causa na ficha da ocorrência.</td></tr>) : <tr><td colSpan={8} className="empty">Carregando…</td></tr>}</tbody>
  </table></div></div>;
}

function Achados({ qp, accountId, canEdit, onCreated, k }: { qp: () => URLSearchParams; accountId: string; canEdit: boolean; onCreated: () => void; k: number }) {
  const d = useJson<{ findings: { type: string; title: string; description: string; confidence: string; evidence: unknown; suggestedAction: string | null }[]; notProblems: { dimension: string; note: string }[]; sampleSize: number; confidence: string }>(`/post-sale/achados?${qp().toString()}`, k);
  const [busy, setBusy] = useState('');
  if (!d) return <div className="panel"><div className="empty">Carregando…</div></div>;
  function createPlan(title: string, findingType: string) {
    setBusy(findingType); api.post(`/post-sale/action-plans?marketplaceAccountId=${accountId}`, { title, origin: 'finding', relatedFindings: [findingType], priority: 'ALTA' })
      .then(() => onCreated()).finally(() => setBusy(''));
  }
  return <>
    <div className="count-line">Amostra: <b>{nn(d.sampleSize)}</b> ocorrências · confiança <b>{d.confidence}</b></div>
    {d.findings.length ? d.findings.map((f, i) => (
      <div className="panel" key={i}><div className="ph"><h3>{f.title}</h3><span className={`tag ${f.confidence === 'ALTA' ? 'ok' : f.confidence === 'MEDIA' ? 'info' : 'warn'}`}>{f.confidence}</span></div><div className="pb">
        <p style={{ marginTop: 0 }}>{f.description}</p>
        {f.suggestedAction && <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="footnote" style={{ margin: 0 }}>Ação sugerida: <b>{f.suggestedAction}</b></span>{canEdit && <button className="btn-sm primary" disabled={!!busy} onClick={() => createPlan(f.suggestedAction!, f.type)}>Criar plano de ação</button>}</div>}
      </div></div>
    )) : <div className="panel"><div className="empty">Nenhum achado relevante no período. 🎉</div></div>}
    {d.notProblems.length > 0 && <div className="panel"><div className="ph"><h3>O que o problema NÃO é</h3></div><div className="pb">{d.notProblems.map((np, i) => <div className="fin-line" key={i}><span><b>{np.dimension}</b></span><span className="footnote" style={{ margin: 0 }}>{np.note}</span></div>)}</div></div>}
  </>;
}

interface Plan { id: string; title: string; description: string | null; status: string; priority: string; ownerName: string | null; indicator: string | null; relatedSkus: string[]; checklist: { id: string; text: string; done: boolean }[]; measure: { baseline: number | null; current: number; currentAfterImplementation: number | null; delta: number | null; improved: boolean | null; indicator: string | null; hasScope: boolean } }
const PLAN_STATUS: Record<string, string> = { SUGGESTED: 'Sugerido', PLANNED: 'Planejado', IN_PROGRESS: 'Em andamento', IMPLEMENTED: 'Implantado', MEASURING: 'Medindo', DONE: 'Concluído', DISCARDED: 'Descartado' };

function Planos({ accountId, canEdit, k }: { accountId: string; canEdit: boolean; k: number }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [title, setTitle] = useState(''); const [skus, setSkus] = useState('');
  const load = useCallback(() => { api.get<Plan[]>(`/post-sale/action-plans?marketplaceAccountId=${accountId}`).then(setPlans); }, [accountId]);
  useEffect(() => { load(); }, [load, k]);
  function create() { if (!title.trim()) return; api.post(`/post-sale/action-plans?marketplaceAccountId=${accountId}`, { title, priority: 'MEDIA', relatedSkus: skus.split(',').map((s) => s.trim()).filter(Boolean) }).then(() => { setTitle(''); setSkus(''); load(); }); }
  function setStatus(id: string, status: string) { api.patch(`/post-sale/action-plans/${id}`, { status }).then(load); }
  function toggle(id: string, itemId: string, done: boolean) { api.patch(`/post-sale/action-plans/${id}/checklist`, { itemId, done }).then(load); }
  function addItem(id: string, text: string) { api.post(`/post-sale/action-plans/${id}/checklist`, { text }).then(load); }
  function del(id: string) { api.del(`/post-sale/action-plans/${id}`).then(load); }
  return <>
    {canEdit && <div className="importbar"><div style={{ flex: 1, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <input className="input sm" style={{ flex: 2, minWidth: 220 }} placeholder="Nova ação (ex.: novo padrão de embalagem 80x120)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="input sm" style={{ flex: 1, minWidth: 160 }} placeholder="SKUs (vírgula) — escopo/medição" value={skus} onChange={(e) => setSkus(e.target.value)} />
      <button className="btn-sm primary" onClick={create}>Criar plano</button>
    </div></div>}
    {plans ? (plans.length ? plans.map((p) => (
      <div className="panel" key={p.id}><div className="ph"><h3>{p.title}</h3><span className="tag info">{PLAN_STATUS[p.status] ?? p.status}</span></div><div className="pb">
        <div className="kpi-grid" style={{ marginBottom: 10 }}>
          {card('Baseline (antes)', p.measure.baseline == null ? '—' : brl(p.measure.baseline))}
          {card('Atual', brl(p.measure.current))}
          {card('Δ (depois − antes)', p.measure.delta == null ? '—' : brl(p.measure.delta), p.measure.improved ? 'green' : p.measure.improved === false ? 'red' : '')}
          {card('Desde a implantação', p.measure.currentAfterImplementation == null ? 'não implantado' : brl(p.measure.currentAfterImplementation))}
        </div>
        {p.relatedSkus.length > 0 && <div className="footnote">Escopo: {p.relatedSkus.join(', ')}</div>}
        <div style={{ marginTop: 8 }}>{p.checklist.map((it) => <label key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}><input type="checkbox" checked={it.done} disabled={!canEdit} onChange={(e) => toggle(p.id, it.id, e.target.checked)} /> <span style={{ textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--muted)' : 'inherit' }}>{it.text}</span></label>)}</div>
        {canEdit && <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <ChecklistAdd onAdd={(t) => addItem(p.id, t)} />
          <select className="select sm" value={p.status} onChange={(e) => setStatus(p.id, e.target.value)}>{Object.entries(PLAN_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className="btn-sm" onClick={() => del(p.id)}>Excluir</button>
        </div>}
      </div></div>
    )) : <div className="panel"><div className="empty">Nenhum plano de ação. Crie um a partir de um Achado ou manualmente.</div></div>) : <div className="panel"><div className="empty">Carregando…</div></div>}
  </>;
}
function ChecklistAdd({ onAdd }: { onAdd: (t: string) => void }) {
  const [t, setT] = useState('');
  return <span style={{ display: 'flex', gap: 6 }}><input className="input sm" style={{ width: 200 }} placeholder="+ item do checklist" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && t.trim()) { onAdd(t.trim()); setT(''); } }} /></span>;
}

function Financeiro({ qp, k }: { qp: () => URLSearchParams; k: number }) {
  const d = useJson<{ refundedTotal: number; additionalCostTotal: number; recoveredTotal: number; compensation: number; disputeRecovery: number; confirmedLoss: number; atRisk: number; knownNetImpact: number; cmvAvailable: boolean }>(`/post-sale/financeiro?${qp().toString()}`, k);
  if (!d) return <div className="panel"><div className="empty">Carregando…</div></div>;
  return <>
    <div className="kpi-grid">
      {card('Reembolso pago', brl(d.refundedTotal), 'red')}
      {card('Custos adicionais', brl(d.additionalCostTotal), 'amber', 'frete reverso, retrabalho')}
      {card('Compensação Shopee', brl(d.compensation), 'green')}
      {card('Recuperação de disputa', brl(d.disputeRecovery), 'green')}
      {card('Recuperado (total)', brl(d.recoveredTotal), 'green')}
      {card('Impacto líquido conhecido', brl(d.knownNetImpact), 'red')}
      {card('Em risco', brl(d.atRisk), 'amber')}
    </div>
    <div className="info-banner">Impacto líquido = custos conhecidos (reembolso + frete reverso + retrabalho…) − recuperações conhecidas (compensação + recuperação de disputa + valor recuperável). {!d.cmvAvailable && 'CMV (custo da mercadoria perdida) ainda não disponível — não é estimado.'}</div>
  </>;
}

function Disputas({ qp, k }: { qp: () => URLSearchParams; k: number }) {
  const d = useJson<{ possiveis: number; abertas: number; vencendo: number; vencidas: number; respondidas: number; ganhas: number; perdidas: number; prazoPerdido: number; taxaResposta: number; valorContestado: number; valorRecuperado: number }>(`/post-sale/disputas?${qp().toString()}`, k);
  if (!d) return <div className="panel"><div className="empty">Carregando…</div></div>;
  return <div className="kpi-grid">
    {card('Possíveis', nn(d.possiveis))}
    {card('Abertas', nn(d.abertas))}
    {card('Vencendo (≤3d)', nn(d.vencendo), 'amber')}
    {card('Vencidas', nn(d.vencidas), 'red')}
    {card('Respondidas', nn(d.respondidas))}
    {card('Taxa de resposta', pctv(d.taxaResposta))}
    {card('Ganhas', nn(d.ganhas), 'green')}
    {card('Perdidas', nn(d.perdidas), 'red')}
    {card('Valor contestado', brl(d.valorContestado))}
    {card('Valor recuperado', brl(d.valorRecuperado), 'green')}
  </div>;
}

function Pendencias({ accountId, go, k }: { accountId: string; go: (t: string) => void; k: number }) {
  const d = useJson<{ key: string; label: string; count: number; priority: number }[]>(`/post-sale/pendencias?marketplaceAccountId=${accountId}`, k);
  return <div className="panel"><div className="ph"><h3>Fila operacional — o que fazer agora</h3></div><div className="pb">
    {d ? (d.length ? d.map((p) => <div className="fin-line" key={p.key}><span>{p.label}</span><span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><b>{nn(p.count)}</b><button className="btn-sm" onClick={() => go('ocorrencias')}>Trabalhar</button></span></div>) : <div className="footnote">Nada pendente no momento. 🎉</div>) : <div className="empty">Carregando…</div>}
  </div></div>;
}

function Saude({ accountId }: { accountId: string }) {
  const c = useJson<{ perType: { label: string; count: number; periodStart: string | null; periodEnd: string | null }[]; dataHealth: { totalItems: number; withSkuPct: number; linkedPct: number; unlinkedItems: number } }>(`/post-sale/coverage?marketplaceAccountId=${accountId}`);
  if (!c) return <div className="panel"><div className="empty">Carregando…</div></div>;
  return <>
    <div className="kpi-grid">{card('Itens', nn(c.dataHealth.totalItems))}{card('Com SKU', c.dataHealth.withSkuPct + '%')}{card('Vinculados', c.dataHealth.linkedPct + '%')}{card('Itens sem vínculo', nn(c.dataHealth.unlinkedItems), 'amber')}</div>
    <div className="panel"><div className="ph"><h3>Cobertura por relatório</h3></div><div className="table-wrap"><table><thead><tr><th>Relatório</th><th>Ocorrências</th><th>Período</th></tr></thead><tbody>{c.perType.map((t) => <tr key={t.label}><td>{t.label}</td><td>{nn(t.count)}</td><td className="footnote">{t.periodStart ? `${dateBR(t.periodStart).split(' ')[0]} – ${dateBR(t.periodEnd!).split(' ')[0]}` : '—'}</td></tr>)}</tbody></table></div></div>
  </>;
}

function Importacoes({ accountId, canEdit, onDone }: { accountId: string; canEdit: boolean; onDone: (m: string) => void }) {
  const [batches, setBatches] = useState<Record<string, string | number>[]>([]);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { api.get<Record<string, string | number>[]>(`/post-sale/import-batches?marketplaceAccountId=${accountId}`).then(setBatches); }, [accountId]);
  useEffect(() => { load(); }, [load]);
  const types: [string, string][] = [['RETURN_REFUND', 'Devoluções / Reembolsos'], ['ORDER_CANCELLATION', 'Cancelamentos'], ['FAILED_DELIVERY', 'Falhas de Entrega']];
  function pick(type: string) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
    inp.onchange = () => { const file = inp.files?.[0]; if (!file) return; setBusy(type); const form = new FormData(); form.append('marketplaceAccountId', accountId); form.append('type', type); form.append('file', file);
      api.upload<Record<string, number>>('/post-sale/import', form).then((r) => { onDone(`${r.occurrencesSeen} ocorrências · ${r.newOccurrences} novas · ${r.updatedOccurrences} atualizadas`); load(); }).catch((e) => onDone('Falha: ' + e.message)).finally(() => setBusy('')); };
    inp.click();
  }
  return <>
    {canEdit && <div className="kpi-grid">{types.map(([t, l]) => <div className="kpi" key={t}><div className="lbl">{l}</div><button className="btn-sm primary" style={{ marginTop: 10 }} disabled={!!busy} onClick={() => pick(t)}>{busy === t ? 'Processando…' : 'Importar planilha'}</button></div>)}</div>}
    <div className="panel"><div className="ph"><h3>Histórico de importações</h3></div><div className="table-wrap"><table><thead><tr><th>Relatório</th><th>Arquivo</th><th>Ocorrências</th><th>Novas</th><th>Atualizadas</th><th>Itens</th><th>Data</th></tr></thead><tbody>{batches.length ? batches.map((b) => <tr key={b.id as string}><td>{String(b.occurrenceType ?? '')}</td><td>{b.originalFilename as string}</td><td>{nn(b.occurrencesSeen as number)}</td><td>{nn(b.newOccurrences as number)}</td><td>{nn(b.updatedOccurrences as number)}</td><td>{nn(b.itemsSeen as number)}</td><td className="footnote" style={{ margin: 0 }}>{dateBR(b.createdAt as string)}</td></tr>) : <tr><td colSpan={7} className="empty">Nenhuma importação.</td></tr>}</tbody></table></div></div>
  </>;
}

// ------------------------------------------------------- Ficha operacional
interface Ficha {
  id: string; type: string; externalOrderId: string; externalReturnId: string | null; status: string | null; reason: string | null; reasonRevised: string | null; resolution: string | null;
  requestedRefundAmount: string | null; sellerCompensationAmount: string | null; occurredAt: string | null;
  internalStatus: string; priority: string; ownerName: string | null; internalCause: string | null; causeFamily: string | null; responsibility: string;
  merchandiseStatus: string; merchandiseCondition: string | null; recoverableValue: string | null; operatorNotes: string | null;
  hasDispute: boolean; disputeStatus: string; disputeRecoveredAmount: string | null; disputeContestedAmount: string | null; disputeNote: string | null;
  impact: { refundedTotal: number; additionalCostTotal: number; recoveredTotal: number; knownNetImpact: number | null; cmvAvailable: boolean };
  order: { id: string; externalOrderId: string; normalizedStatus: string | null } | null;
  items: { id: string; sku: string | null; productName: string | null; productVariation: { family: { name: string } | null } | null }[];
  financialEvents: { id: string; type: string; direction: string; amount: string; note: string | null; createdByName: string | null; occurredAt: string }[];
  activities: { id: string; kind: string; field: string | null; oldValue: string | null; newValue: string | null; message: string | null; userName: string | null; createdAt: string }[];
}

function FichaDrawer({ id, canEdit, onClose, onChange }: { id: string; canEdit: boolean; onClose: () => void; onChange: () => void }) {
  const [o, setO] = useState<Ficha | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get<Ficha>(`/post-sale/occurrences/${id}`).then(setO); }, [id]);
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>) { setBusy(true); try { const r = await api.patch<Ficha>(`/post-sale/occurrences/${id}`, body); setO(r); onChange(); } finally { setBusy(false); } }
  async function post(path: string, body: Record<string, unknown>) { setBusy(true); try { const r = await api.post<Ficha>(`/post-sale/occurrences/${id}/${path}`, body); setO(r); onChange(); } finally { setBusy(false); } }

  const sel = (label: string, value: string, opts: Record<string, string>, field: string) => (
    <div><label className="fld">{label}</label><select className="select" style={{ width: '100%' }} value={value} disabled={!canEdit || busy} onChange={(e) => patch({ [field]: e.target.value })}>{Object.entries(opts).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
  );

  return (
    <div className="drawer drawer-wide" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer-panel" style={{ width: 940, maxWidth: '97vw' }}>
        <div className="dh"><div><b>Ficha — {o?.externalOrderId ?? id}</b>{o && <span className="pill st-int" style={{ marginLeft: 8 }}>{INTERNAL_STATUS[o.internalStatus]}</span>}</div><button className="x" onClick={onClose}>×</button></div>
        <div className="dbd">
          {!o ? <div className="empty">Carregando…</div> : (<>
            <div className="kpi-grid">
              {card('Reembolso', brl(o.impact.refundedTotal), 'red')}
              {card('Custos adicionais', brl(o.impact.additionalCostTotal), 'amber')}
              {card('Recuperado', brl(o.impact.recoveredTotal), 'green')}
              {card('Impacto líquido', o.impact.knownNetImpact == null ? '—' : brl(o.impact.knownNetImpact), 'red', o.impact.cmvAvailable ? '' : 'CMV não disponível')}
            </div>
            <div className="split">
              <div>
                <div className="panel"><div className="ph"><h3>Dados da Shopee</h3></div><div className="pb">
                  <label className="fld">Motivo (original)</label><div className="ro">{o.reason ?? '—'}</div>
                  {o.reasonRevised && <><label className="fld">Motivo revisado</label><div className="ro">{o.reasonRevised}</div></>}
                  <label className="fld">Status Shopee</label><div className="ro">{o.status ?? '—'}</div>
                  <label className="fld">Reembolso solicitado</label><div className="ro">{brl(o.requestedRefundAmount)}</div>
                  {o.order && <><label className="fld">Pedido</label><div className="ro"><span className="mono">{o.order.externalOrderId}</span> · {o.order.normalizedStatus ?? '—'}</div></>}
                  <label className="fld">Itens</label>{o.items.map((it) => <div className="ro" key={it.id} style={{ marginBottom: 4 }}><span className="mono">{it.sku ?? '—'}</span> {it.productName ? '· ' + it.productName.slice(0, 40) : ''}{it.productVariation?.family?.name ? ` · ${it.productVariation.family.name}` : ''}</div>)}
                </div></div>

                <div className="panel"><div className="ph"><h3>Impacto financeiro</h3></div><div className="pb">
                  <div className="fin-line"><span>Reembolso pago</span><span className="neg">{brl(o.impact.refundedTotal)}</span></div>
                  <div className="fin-line"><span>Custos adicionais (frete reverso, retrabalho)</span><span className="neg">{brl(o.impact.additionalCostTotal)}</span></div>
                  <div className="fin-line"><span>Recuperações (compensação, disputa, produto)</span><span className="pos">-{brl(o.impact.recoveredTotal)}</span></div>
                  <div className="fin-line total"><span>Impacto líquido conhecido</span><span className="neg">{o.impact.knownNetImpact == null ? '—' : brl(o.impact.knownNetImpact)}</span></div>
                  {canEdit && <AddEvent onAdd={(b) => post('financial-event', b)} busy={busy} />}
                  {o.financialEvents.length > 0 && <div style={{ marginTop: 10 }}>{o.financialEvents.map((e) => <div className="fin-line" key={e.id}><span>{EVENT_TYPES[e.type] ?? e.type}{e.note ? ` · ${e.note}` : ''}</span><span className={e.direction === 'RECOVERY' ? 'pos' : 'neg'}>{e.direction === 'RECOVERY' ? '-' : ''}{brl(e.amount)}</span></div>)}</div>}
                </div></div>
              </div>

              <div>
                <div className="panel"><div className="ph"><h3>Controle interno</h3></div><div className="pb">
                  {sel('Status interno', o.internalStatus, INTERNAL_STATUS, 'internalStatus')}
                  {sel('Prioridade', o.priority, PRIORITY, 'priority')}
                  <label className="fld">Responsável</label><input className="input" style={{ width: '100%' }} defaultValue={o.ownerName ?? ''} disabled={!canEdit || busy} onBlur={(e) => { if (e.target.value !== (o.ownerName ?? '')) patch({ ownerName: e.target.value || null }); }} placeholder="nome do responsável" />
                  <label className="fld">Causa interna</label><input className="input" style={{ width: '100%' }} defaultValue={o.internalCause ?? ''} disabled={!canEdit || busy} onBlur={(e) => { if (e.target.value !== (o.internalCause ?? '')) patch({ internalCause: e.target.value || null }); }} placeholder="ex.: proteção insuficiente do vidro" />
                  <label className="fld">Família da causa</label><input className="input" style={{ width: '100%' }} defaultValue={o.causeFamily ?? ''} disabled={!canEdit || busy} onBlur={(e) => { if (e.target.value !== (o.causeFamily ?? '')) patch({ causeFamily: e.target.value || null }); }} placeholder="ex.: Avaria / Embalagem" />
                  {sel('Responsabilidade', o.responsibility, RESPONSIBILITY, 'responsibility')}
                  {sel('Situação da mercadoria', o.merchandiseStatus, MERCH_STATUS, 'merchandiseStatus')}
                  {sel('Condição (se recebida)', o.merchandiseCondition ?? '', { '': '—', ...MERCH_COND }, 'merchandiseCondition')}
                </div></div>

                <div className="panel"><div className="ph"><h3>Disputa</h3><span className="tag info">{DISPUTE_STATUS[o.disputeStatus]}</span></div><div className="pb">
                  <DisputeForm o={o} canEdit={canEdit} busy={busy} onResolve={(b) => post('dispute', b)} />
                </div></div>
              </div>
            </div>

            <div className="panel"><div className="ph"><h3>Timeline & auditoria</h3></div><div className="pb">
              {canEdit && <CommentBox onAdd={(m) => post('comment', { message: m })} busy={busy} />}
              {o.activities.length ? o.activities.map((a) => (
                <div className="fin-line" key={a.id}><span>{a.kind === 'COMMENT' ? `💬 ${a.message}` : a.kind === 'FINANCIAL' ? `💰 ${a.message}` : a.kind === 'DISPUTE' ? `⚖️ ${a.field}: ${a.oldValue ?? '∅'} → ${a.newValue ?? '∅'}${a.message ? ' · ' + a.message : ''}` : `${a.field}: ${a.oldValue ?? '∅'} → ${a.newValue ?? '∅'}`}{a.userName ? ` — ${a.userName}` : ''}</span><span className="footnote" style={{ margin: 0 }}>{dateBR(a.createdAt)}</span></div>
              )) : <div className="footnote">Sem atividade ainda.</div>}
            </div></div>
          </>)}
        </div>
      </div>
    </div>
  );
}

function AddEvent({ onAdd, busy }: { onAdd: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [type, setType] = useState('FRETE_REVERSO'); const [amount, setAmount] = useState('');
  return <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
    <select className="select sm" value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(EVENT_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    <input className="input sm" style={{ width: 100 }} placeholder="valor" value={amount} onChange={(e) => setAmount(e.target.value)} />
    <button className="btn-sm primary" disabled={busy || !amount} onClick={() => { onAdd({ type, amount: Number(amount.replace(',', '.')) }); setAmount(''); }}>+ Movimentação</button>
  </div>;
}

function DisputeForm({ o, canEdit, busy, onResolve }: { o: Ficha; canEdit: boolean; busy: boolean; onResolve: (b: Record<string, unknown>) => void }) {
  const [result, setResult] = useState(o.disputeStatus); const [recovered, setRecovered] = useState(''); const [compensation, setCompensation] = useState('');
  if (!canEdit) return null;
  return <div style={{ marginTop: 8 }}>
    <select className="select sm" value={result} onChange={(e) => setResult(e.target.value)} style={{ width: '100%' }}>{Object.entries(DISPUTE_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    {(result === 'GANHA' || result === 'PARCIAL') && <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
      <input className="input sm" style={{ flex: 1 }} placeholder="valor recuperado" value={recovered} onChange={(e) => setRecovered(e.target.value)} />
      <input className="input sm" style={{ flex: 1 }} placeholder="compensação" value={compensation} onChange={(e) => setCompensation(e.target.value)} />
    </div>}
    <button className="btn-sm primary" style={{ marginTop: 8 }} disabled={busy} onClick={() => onResolve({ result, ...(recovered ? { recoveredAmount: Number(recovered.replace(',', '.')) } : {}), ...(compensation ? { compensationAmount: Number(compensation.replace(',', '.')) } : {}) })}>Salvar disputa</button>
  </div>;
}

function CommentBox({ onAdd, busy }: { onAdd: (m: string) => void; busy: boolean }) {
  const [m, setM] = useState('');
  return <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}><input className="input sm" style={{ flex: 1 }} placeholder="Adicionar comentário…" value={m} onChange={(e) => setM(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && m.trim()) { onAdd(m.trim()); setM(''); } }} /><button className="btn-sm" disabled={busy || !m.trim()} onClick={() => { onAdd(m.trim()); setM(''); }}>Comentar</button></div>;
}
