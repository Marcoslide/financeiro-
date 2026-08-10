'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

interface Account { id: string; displayName: string }
const brl = (v: number | null | undefined) => (v == null ? 'R$ 0,00' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const nn = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR');

interface Settings { provider: string; model: string; enabled: boolean; hasKey: boolean; supportedProviders: string[]; defaultModels: Record<string, string>; updatedAt: string | null }

export default function InteligenciaPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'FINANCIAL';
  const [account, setAccount] = useState<Account | null>(null);
  const [sub, setSub] = useState<'chat' | 'config'>('chat');
  useEffect(() => { api.get<Account[]>('/marketplace-accounts').then((a) => setAccount(a[0] ?? null)); }, []);

  return (
    <>
      <div className="page-head">
        <div><h2>Inteligência</h2><p>Chat sobre os dados com <b>Preview</b> ao lado. A IA nunca inventa números nem calcula dinheiro — os cálculos são determinísticos e auditáveis.</p></div>
      </div>
      <div className="tabs">
        <div className={`tab ${sub === 'chat' ? 'active' : ''}`} onClick={() => setSub('chat')}>Análises &amp; Chat</div>
        <div className={`tab ${sub === 'config' ? 'active' : ''}`} onClick={() => setSub('config')}>Configuração</div>
      </div>
      {account && sub === 'chat' && <ChatArea accountId={account.id} />}
      {account && sub === 'config' && <Config canEdit={canEdit} />}
    </>
  );
}

function Config({ canEdit }: { canEdit: boolean }) {
  const [s, setS] = useState<Settings | null>(null);
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api.get<Settings>('/ai/settings').then((x) => { setS(x); setProvider(x.provider); setModel(x.model); setEnabled(x.enabled); }); }, []);
  useEffect(() => { load(); }, [load]);

  function save() {
    setBusy(true);
    api.put<Settings>('/ai/settings', { provider, model, enabled, ...(apiKey ? { apiKey } : {}) } as unknown as Record<string, unknown>)
      .then(() => { setApiKey(''); setMsg({ ok: true, text: 'Configuração salva. A chave é cifrada no servidor e nunca retorna ao navegador.' }); load(); })
      .catch((e) => setMsg({ ok: false, text: e.message })).finally(() => setBusy(false));
  }
  function test() {
    setBusy(true); setMsg(null);
    api.post<{ ok: boolean; message: string }>('/ai/test', {})
      .then((r) => setMsg({ ok: r.ok, text: r.message })).catch((e) => setMsg({ ok: false, text: e.message })).finally(() => setBusy(false));
  }

  if (!s) return <div className="panel"><div className="empty">Carregando…</div></div>;
  return (
    <div className="panel" style={{ maxWidth: 620 }}><div className="pb">
      <div className="info-banner">A credencial da IA é cifrada com AES-256-GCM e guardada apenas no backend. Ela <b>nunca</b> é incluída no bundle do frontend nem retorna nas respostas (§46).</div>
      <label className="fld">Provedor</label>
      <select className="select" value={provider} disabled={!canEdit} onChange={(e) => { setProvider(e.target.value); setModel(s.defaultModels[e.target.value] ?? ''); }}>
        {s.supportedProviders.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <label className="fld">Modelo</label>
      <input className="input" style={{ width: '100%' }} value={model} disabled={!canEdit} onChange={(e) => setModel(e.target.value)} placeholder={s.defaultModels[provider]} />
      <label className="fld">Chave de API {s.hasKey && <span className="tag ok">cadastrada</span>}</label>
      <input className="input" style={{ width: '100%' }} type="password" value={apiKey} disabled={!canEdit} onChange={(e) => setApiKey(e.target.value)} placeholder={s.hasKey ? '•••••••• (deixe em branco para manter)' : 'cole a chave do provedor'} />
      <label className="fld" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} /> Habilitar IA
      </label>
      {msg && <div className={msg.ok ? 'info-banner' : 'form-err'} style={{ marginTop: 12 }}>{msg.text}</div>}
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn-sm primary" disabled={busy} onClick={save}>Salvar</button>
          <button className="btn-sm" disabled={busy || !s.hasKey} onClick={test}>Testar conexão</button>
        </div>
      )}
      <div className="footnote" style={{ marginTop: 14 }}>Suportado: Anthropic e OpenAI. O sistema é desacoplado do provedor — trocar não afeta as análises determinísticas.</div>
    </div></div>
  );
}

interface Evidence {
  totals: { occurrences: number; distinctOrders: number; byType: Record<string, number>; unlinkedItems: number };
  exposure: { requested: number; confirmedLoss: number; atRisk: number; recovered: number; cancelled: number };
  topSkus: { sku: string; product: string; occurrences: number; confirmedLoss: number }[];
  topReasons: { reason: string; count: number }[];
  dataHealth: { totalItems: number; withSkuPct: number; linkedPct: number; unlinkedItems: number };
  sampleSize: number;
}
interface Msg { role: 'u' | 'a'; text: string; cites?: string[]; status?: string }

function ChatArea({ accountId }: { accountId: string }) {
  const ev = useJson<Evidence>(`/ai/evidence?marketplaceAccountId=${accountId}`);
  const [chat, setChat] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [chat]);

  function send(question?: string) {
    const text = (question ?? q).trim(); if (!text || busy) return;
    setChat((c) => [...c, { role: 'u', text }]); setQ(''); setBusy(true);
    api.post<{ output?: { answer?: string; citations?: string[] }; status?: string; warning?: string }>('/ai/chat', { marketplaceAccountId: accountId, question: text })
      .then((r) => setChat((c) => [...c, { role: 'a', text: r.output?.answer ?? (r.warning ?? 'Sem resposta.'), cites: r.output?.citations, status: r.status }]))
      .catch((e) => setChat((c) => [...c, { role: 'a', text: 'IA não configurada ou indisponível: ' + e.message + '. Configure em Inteligência › Configuração.' }]))
      .finally(() => setBusy(false));
  }

  const chips = ['Resuma o período', 'Quais SKUs concentram mais devoluções?', 'Onde estão minhas perdas?', 'Quais motivos mais aparecem?'];
  return (
    <div className="split">
      <div className="chatbox">
        <div className="chatlog" ref={logRef}>
          {chat.length === 0 && <div className="msg a">Pergunte sobre devoluções, perdas, SKUs e motivos. As respostas usam as evidências determinísticas do Preview ao lado — a IA redige, mas não inventa números.</div>}
          {chat.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.text.split('\n').map((l, j) => <div key={j}>{l}</div>)}
              {m.cites && m.cites.length > 0 && <div className="cites">Evidências: {m.cites.join(' · ')}</div>}
            </div>
          ))}
          {busy && <div className="msg a">Analisando…</div>}
        </div>
        <div className="chips">{chips.map((c) => <span key={c} className="chip" onClick={() => send(c)}>{c}</span>)}</div>
        <div className="chatin">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Pergunte sobre devoluções, perdas, SKUs, motivos…" />
          <button className="btn-sm primary" disabled={busy} onClick={() => send()}>Enviar</button>
        </div>
      </div>
      <div className="prev">
        <h4>Preview · evidências determinísticas</h4>
        {!ev ? <div className="footnote">Carregando…</div> : (<>
          <div className="row"><span>Ocorrências</span><b>{nn(ev.totals.occurrences)}</b></div>
          <div className="row"><span>Pedidos distintos</span><b>{nn(ev.totals.distinctOrders)}</b></div>
          <div className="row"><span>Prejuízo confirmado</span><b>{brl(ev.exposure.confirmedLoss)}</b></div>
          <div className="row"><span>Em risco</span><b>{brl(ev.exposure.atRisk)}</b></div>
          <div className="row"><span>Recuperado</span><b>{brl(ev.exposure.recovered)}</b></div>
          <div className="row"><span>Itens sem vínculo</span><b>{nn(ev.totals.unlinkedItems)}</b></div>
          <div className="row"><span>Cobertura de SKU</span><b>{ev.dataHealth.withSkuPct}%</b></div>
          <h4 style={{ marginTop: 14 }}>Top SKUs</h4>
          {ev.topSkus.slice(0, 6).map((s) => <div className="row" key={s.sku}><span className="mono" style={{ fontSize: 11 }}>{s.sku}</span><b>{s.occurrences}</b></div>)}
          <div className="footnote" style={{ marginTop: 10 }}>Base factual das respostas do chat.</div>
        </>)}
      </div>
    </div>
  );
}

function useJson<T>(url: string | null): T | null {
  const [d, setD] = useState<T | null>(null);
  useEffect(() => { setD(null); if (url) api.get<T>(url).then(setD).catch(() => setD(null)); }, [url]);
  return d;
}
