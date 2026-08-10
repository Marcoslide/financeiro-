'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { dateBR } from '@/lib/format';
import { ProductTabs } from '@/components/products/ProductTabs';

interface Account { id: string; displayName: string }
interface Family {
  id: string;
  name: string;
  internalCode: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  currentCostAmount: string | null;
  currentCostEffectiveFrom: string | null;
  costUpdatedAt: string | null;
  variationCount: number;
}
interface CostEntry { id: string; costAmount: string; effectiveFrom: string; createdAt: string }
interface FamilyDetail extends Family { costHistory: CostEntry[] }

const brl = (v: string | null) =>
  v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function FamiliasPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'FINANCIAL';

  const [account, setAccount] = useState<Account | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE' | 'NOCOST'>('');
  const [editing, setEditing] = useState<Family | 'new' | null>(null);

  useEffect(() => {
    api.get<Account[]>('/marketplace-accounts').then((rows) => setAccount(rows[0] ?? null));
  }, []);

  const load = useCallback(() => {
    if (!account) return;
    setLoading(true);
    const p = new URLSearchParams({ marketplaceAccountId: account.id });
    if (search.trim()) p.set('search', search.trim());
    api.get<Family[]>(`/products/families?${p.toString()}`).then(setFamilies).finally(() => setLoading(false));
  }, [account, search]);

  useEffect(() => { load(); }, [load]);

  const shown = families.filter((f) =>
    statusFilter === '' ? true :
    statusFilter === 'NOCOST' ? f.currentCostAmount == null :
    f.status === statusFilter,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Produtos</h2>
          <p>A família é a unidade interna de custo. Vários SKUs apontam para uma família; o custo mora aqui, com histórico.</p>
        </div>
        {canEdit && account && (
          <button className="btn-sm primary" onClick={() => setEditing('new')}>+ Nova família</button>
        )}
      </div>
      <ProductTabs />

      {!canEdit && (
        <div className="info-banner">Seu perfil (Consulta) pode visualizar as famílias, mas não criar nem editar.</div>
      )}

      <div className="panel">
        <div className="ph">
          <h3>Famílias cadastradas</h3>
          <span className="footnote" style={{ margin: 0 }}>{shown.length} família(s)</span>
        </div>
        <div className="pb">
          <div className="toolbar">
            <input className="input" style={{ width: 260 }} placeholder="Buscar família" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="">Todas</option>
              <option value="ACTIVE">Ativas</option>
              <option value="INACTIVE">Inativas</option>
              <option value="NOCOST">Sem custo</option>
            </select>
          </div>
        </div>
        <div className="pb" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty">Carregando…</div>
          ) : shown.length === 0 ? (
            <div className="empty"><div className="ico">⁘</div><p>Nenhuma família ainda. {canEdit && 'Crie a primeira para começar a atribuir custo.'}</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Família</th><th>Código</th><th>Custo atual</th><th>SKUs vinculados</th><th>Status</th><th>Custo atualizado</th><th></th></tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr key={f.id}>
                      <td><b>{f.name}</b></td>
                      <td className="mono">{f.internalCode ?? '—'}</td>
                      <td>{f.currentCostAmount != null ? brl(f.currentCostAmount) : <span className="badge b-warn">não informado</span>}</td>
                      <td>{f.variationCount}</td>
                      <td><span className={`badge ${f.status === 'ACTIVE' ? 'b-ok' : 'b-neutral'}`}>{f.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}</span></td>
                      <td className="footnote" style={{ margin: 0 }}>{f.costUpdatedAt ? dateBR(f.costUpdatedAt) : '—'}</td>
                      <td>{canEdit && <button className="btn-sm" onClick={() => setEditing(f)}>Editar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editing && account && (
        <FamilyModal
          accountId={account.id}
          family={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function FamilyModal({
  accountId, family, onClose, onSaved,
}: {
  accountId: string;
  family: Family | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(family?.name ?? '');
  const [internalCode, setInternalCode] = useState(family?.internalCode ?? '');
  const [notes, setNotes] = useState(family?.notes ?? '');
  const [cost, setCost] = useState(family?.currentCostAmount ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(family?.status ?? 'ACTIVE');
  const [history, setHistory] = useState<CostEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (family) {
      api.get<FamilyDetail>(`/products/families/${family.id}`).then((d) => setHistory(d.costHistory ?? []));
    }
  }, [family]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const currentCost = family?.currentCostAmount ?? null;
      const costChanged = cost.trim() !== '' && cost.trim() !== (currentCost ?? '');
      if (family) {
        await api.patch(`/products/families/${family.id}`, {
          name, internalCode, notes, status,
          ...(costChanged ? { cost } : {}),
        });
      } else {
        await api.post('/products/families', {
          marketplaceAccountId: accountId, name, internalCode, notes, status,
          ...(cost.trim() ? { cost } : {}),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a família');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 560, maxWidth: '96vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>{family ? 'Editar família' : 'Nova família'}</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="mbd" style={{ maxHeight: '72vh', overflow: 'auto' }}>
          {error && <div className="form-err" style={{ marginBottom: 12 }}>{error}</div>}
          <label className="fld">Nome da família *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Quadro 40x60 Moldura Premium Sem Vidro" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="fld">Código interno (opcional)</label>
              <input className="input" value={internalCode} onChange={(e) => setInternalCode(e.target.value)} />
            </div>
            <div>
              <label className="fld">Custo do produto (R$)</label>
              <input className="input" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" />
            </div>
          </div>

          <label className="fld">Observações</label>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />

          <label className="fld">Status</label>
          <select className="select" style={{ width: '100%' }} value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="ACTIVE">Ativa</option>
            <option value="INACTIVE">Inativa</option>
          </select>

          <div className="footnote">Ao alterar o custo, o valor anterior é preservado no histórico — pedidos antigos continuam usando o custo vigente na época.</div>

          {family && history.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <label className="fld">Histórico de custo</label>
              <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 10 }}>
                <table>
                  <thead><tr><th>Custo</th><th>Vigente a partir de</th><th>Registrado em</th></tr></thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}>
                        <td>{brl(h.costAmount)}</td>
                        <td>{dateBR(h.effectiveFrom)}</td>
                        <td className="footnote" style={{ margin: 0 }}>{dateBR(h.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="mf">
          <button className="btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn-sm primary" disabled={saving || !name.trim()} onClick={save}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}
