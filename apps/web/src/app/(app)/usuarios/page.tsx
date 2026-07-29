'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateBR, ROLE_LABEL } from '@/lib/format';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'FINANCIAL' | 'VIEWER';
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

const roleBadge: Record<string, string> = { ADMIN: 'b-info', FINANCIAL: 'b-ok', VIEWER: 'b-neutral' };

export default function UsuariosPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'FINANCIAL' });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<UserRow[]>('/users'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await api.post('/users', form);
      setShowModal(false);
      setForm({ name: '', email: '', password: '', role: 'FINANCIAL' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao criar');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    await api.del(`/users/${id}`);
    await load();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Usuários</h2>
          <p>Gestão de acesso da organização. {isAdmin ? '' : 'Somente ADMIN cria/edita.'}</p>
        </div>
        {isAdmin && (
          <button className="btn-sm primary" onClick={() => setShowModal(true)}>
            + Novo usuário
          </button>
        )}
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th>Criado em</th>
                {isAdmin && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>Carregando…</td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td className="mono">{u.email}</td>
                    <td>
                      <span className={`badge ${roleBadge[u.role]}`}>{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td>
                      <span className={`badge ${u.status === 'ACTIVE' ? 'b-ok' : 'b-neutral'}`}>
                        {u.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>{dateBR(u.createdAt)}</td>
                    {isAdmin && (
                      <td>
                        <button
                          className="btn-sm danger"
                          disabled={u.id === user?.id || u.status === 'INACTIVE'}
                          onClick={() => deactivate(u.id)}
                        >
                          Desativar
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <form className="modal" onSubmit={create}>
            <div className="mh">
              <h3>Novo usuário</h3>
              <button type="button" className="x" onClick={() => setShowModal(false)}>
                ×
              </button>
            </div>
            <div className="mbd">
              <label className="fld">Nome</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <label className="fld">E-mail</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              <label className="fld">Senha (mín. 8)</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <label className="fld">Perfil</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="ADMIN">Administrador</option>
                <option value="FINANCIAL">Financeiro</option>
                <option value="VIEWER">Consulta</option>
              </select>
              {err && <div className="form-err">{err}</div>}
            </div>
            <div className="mf">
              <button type="button" className="btn-sm" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-sm primary" disabled={saving}>
                {saving ? 'Salvando…' : 'Criar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
