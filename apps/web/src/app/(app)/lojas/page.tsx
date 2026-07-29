'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { dateBR } from '@/lib/format';

interface Connection {
  sourceType: string;
  connectionStatus: string;
  lastSyncAt: string | null;
}
interface Account {
  id: string;
  displayName: string;
  marketplace: string;
  currency: string;
  timezone: string;
  status: string;
  createdAt: string;
  connections: Connection[];
  _count: { memberships: number };
}

const SOURCE_LABEL: Record<string, string> = {
  MANUAL_UPLOAD: 'Upload manual',
  INTERNAL_SHOPEE_API: 'API interna Shopee',
  SHOPEE_OFFICIAL_API: 'API oficial Shopee',
};

export default function LojasPage() {
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Account[]>('/marketplace-accounts')
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Lojas</h2>
          <p>Contas de marketplace da organização. O MVP começa com uma loja; a arquitetura é multiloja.</p>
        </div>
      </div>

      {loading ? (
        <div className="panel">
          <div className="pb">Carregando…</div>
        </div>
      ) : (
        rows.map((acc) => (
          <div className="panel" key={acc.id}>
            <div className="ph">
              <h3>
                {acc.displayName}{' '}
                <span className="badge b-ok" style={{ marginLeft: 8 }}>
                  {acc.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                </span>
              </h3>
              <span className="footnote" style={{ margin: 0 }}>
                {acc.marketplace} · {acc.currency} · {acc.timezone}
              </span>
            </div>
            <div className="pb">
              <div className="footnote" style={{ marginTop: 0, marginBottom: 12 }}>
                Criada em {dateBR(acc.createdAt)} · {acc._count.memberships} usuário(s) com acesso
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fonte de dados</th>
                      <th>Status</th>
                      <th>Último sincronismo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acc.connections.map((c) => (
                      <tr key={c.sourceType}>
                        <td>{SOURCE_LABEL[c.sourceType] ?? c.sourceType}</td>
                        <td>
                          <span
                            className={`badge ${c.connectionStatus === 'CONFIGURED' ? 'b-ok' : 'b-neutral'}`}
                          >
                            {c.connectionStatus === 'CONFIGURED' ? 'Configurado' : 'Não configurado'}
                          </span>
                        </td>
                        <td>{c.lastSyncAt ? dateBR(c.lastSyncAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}
