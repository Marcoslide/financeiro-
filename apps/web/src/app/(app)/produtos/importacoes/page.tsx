'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { dateBR } from '@/lib/format';
import { ProductTabs } from '@/components/products/ProductTabs';

interface Account { id: string; displayName: string }
interface ProductBatch {
  id: string; originalFilename: string; status: string;
  totalRows: number; productsSeen: number; variationsSeen: number;
  newProducts: number; newVariations: number; updatedRecords: number; unchangedRecords: number;
  ignoredRows: number; errorRows: number; createdAt: string; createdBy: { name: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'b-ok', COMPLETED_WITH_ERRORS: 'b-warn', PROCESSING: 'b-info', FAILED: 'b-err',
};
const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Concluída', COMPLETED_WITH_ERRORS: 'Concluída com erros', PROCESSING: 'Processando', FAILED: 'Falhou',
};

export default function ImportacoesProdutosPage() {
  useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [rows, setRows] = useState<ProductBatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get<Account[]>('/marketplace-accounts').then((a) => setAccount(a[0] ?? null)); }, []);

  const load = useCallback(() => {
    if (!account) return;
    setLoading(true);
    api.get<ProductBatch[]>(`/products/import-batches?marketplaceAccountId=${account.id}`).then(setRows).finally(() => setLoading(false));
  }, [account]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="page-head"><div><h2>Produtos</h2><p>Histórico de importações do catálogo Shopee.</p></div></div>
      <ProductTabs />

      <div className="panel">
        <div className="ph"><h3>Importações de produtos</h3><span className="footnote" style={{ margin: 0 }}>{rows.length} importação(ões)</span></div>
        <div className="pb" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty">Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="empty"><div className="ico">⭱</div><p>Nenhuma importação de produtos ainda.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Arquivo</th><th>Status</th><th>Processados</th><th>Anúncios</th><th>Variações</th>
                    <th>Novos</th><th>Atualizados</th><th>Sem alteração</th><th>Erros</th><th>Data</th><th>Usuário</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td><div style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.originalFilename}</div></td>
                      <td><span className={`badge ${STATUS_BADGE[b.status] ?? 'b-neutral'}`}>{STATUS_LABEL[b.status] ?? b.status}</span></td>
                      <td>{b.totalRows}</td>
                      <td>{b.productsSeen}</td>
                      <td>{b.variationsSeen}</td>
                      <td>{b.newProducts + b.newVariations}</td>
                      <td>{b.updatedRecords}</td>
                      <td>{b.unchangedRecords}</td>
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
      </div>
    </>
  );
}
