'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  IMPORT_BATCH_STATUS_LABELS,
  ImportBatchStatus,
  REPORT_TYPE_LABELS,
  ReportType,
} from '@financeiro/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateBR } from '@/lib/format';
import { ImportWizard } from '@/components/ImportWizard';

interface Batch {
  id: string;
  originalFilename: string;
  reportType: ReportType;
  status: ImportBatchStatus;
  fileFormat: string;
  headerRowIndex: number | null;
  dataRowCount: number;
  importedRows: number;
  duplicatedRows: number;
  updatedRows: number;
  warningRows: number;
  failedRows: number;
  createdAt: string;
  marketplaceAccount: { displayName: string };
  createdBy: { name: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'b-ok',
  COMPLETED_WITH_ERRORS: 'b-warn',
  AWAITING_CONFIRMATION: 'b-info',
  PROCESSING: 'b-info',
  FAILED: 'b-err',
  DISCARDED: 'b-neutral',
};

export default function ImportacoesPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);

  const canImport = user?.role === 'ADMIN' || user?.role === 'FINANCIAL';

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<Batch[]>('/imports')
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Central de Importações</h2>
          <p>Envie os relatórios da Shopee (CSV, XLS, XLSX). O tipo é detectado pelo conteúdo; nada é gravado sem confirmação.</p>
        </div>
        {canImport && (
          <button className="btn-sm primary" onClick={() => setWizard(true)}>+ Nova importação</button>
        )}
      </div>

      {!canImport && (
        <div className="info-banner">Seu perfil (Consulta) pode acompanhar as importações, mas não enviar arquivos.</div>
      )}

      <div className="panel">
        <div className="ph">
          <h3>Lotes de importação</h3>
          <span className="footnote" style={{ margin: 0 }}>{rows.length} lote(s)</span>
        </div>
        <div className="pb" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty">Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <div className="ico">⭱</div>
              <p>Nenhuma importação ainda. {canImport && 'Clique em “Nova importação” para começar.'}</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Arquivo</th>
                    <th>Relatório</th>
                    <th>Loja</th>
                    <th>Status</th>
                    <th>Importadas</th>
                    <th>Duplicadas</th>
                    <th>Atualizadas</th>
                    <th>Alertas</th>
                    <th>Erros</th>
                    <th>Data</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.originalFilename}</div>
                        <span className="footnote" style={{ margin: 0 }}>{b.fileFormat}{b.headerRowIndex ? ` · cab. linha ${b.headerRowIndex}` : ''}</span>
                      </td>
                      <td>{REPORT_TYPE_LABELS[b.reportType]}</td>
                      <td>{b.marketplaceAccount.displayName}</td>
                      <td><span className={`badge ${STATUS_BADGE[b.status] ?? 'b-neutral'}`}>{IMPORT_BATCH_STATUS_LABELS[b.status]}</span></td>
                      <td>{b.importedRows}</td>
                      <td>{b.duplicatedRows}</td>
                      <td>{b.updatedRows}</td>
                      <td>{b.warningRows}</td>
                      <td>{b.failedRows > 0 ? <b style={{ color: 'var(--err)' }}>{b.failedRows}</b> : 0}</td>
                      <td className="footnote" style={{ margin: 0 }}>{dateBR(b.createdAt)}</td>
                      <td><Link className="btn-sm" href={`/importacoes/${b.id}`}>Abrir</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {wizard && <ImportWizard onClose={() => setWizard(false)} onDone={load} />}
    </>
  );
}
