'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateBR } from '@/lib/format';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  user?: { name: string; email: string } | null;
}

const ACTION_LABEL: Record<string, string> = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  USER_CREATE: 'Criou usuário',
  USER_UPDATE: 'Editou usuário',
  USER_DEACTIVATE: 'Desativou usuário',
  MARKETPLACE_ACCOUNT_UPDATE: 'Editou loja',
};

export default function AuditoriaPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AuditRow[]>('/audit-logs')
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Erro'))
      .finally(() => setLoading(false));
  }, []);

  if (user?.role !== 'ADMIN') {
    return (
      <div className="panel">
        <div className="empty">
          <div className="ico">🔒</div>
          <div>A trilha de auditoria é visível somente para administradores.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Auditoria</h2>
          <p>Trilha de ações do sistema (quem, o quê, quando).</p>
        </div>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Usuário</th>
                <th>Ação</th>
                <th>Entidade</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5}>Carregando…</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={5}>{error}</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dateBR(r.createdAt)}</td>
                    <td>{r.user?.name ?? '—'}</td>
                    <td>
                      <span className="badge b-info">{ACTION_LABEL[r.action] ?? r.action}</span>
                    </td>
                    <td>{r.entityType}</td>
                    <td className="mono">{r.entityId ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
