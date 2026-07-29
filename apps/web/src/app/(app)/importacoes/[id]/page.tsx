'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  IMPORT_BATCH_STATUS_LABELS,
  IMPORT_ROW_STATUS_LABELS,
  ImportRowStatus,
  REPORT_TYPE_LABELS,
  ReportType,
} from '@financeiro/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateBR } from '@/lib/format';

interface Batch {
  id: string;
  originalFilename: string;
  reportType: ReportType;
  detectedReportType: ReportType;
  reportTypeConfidence: number;
  reportTypeManualOverride: boolean;
  status: string;
  fileFormat: string;
  declaredExtension: string;
  extensionMismatch: boolean;
  fileHash: string;
  sheetName: string | null;
  headerRowIndex: number | null;
  dataStartRowIndex: number | null;
  columnCount: number;
  physicalRowCount: number;
  dataRowCount: number;
  totalRows: number;
  validRows: number;
  importedRows: number;
  updatedRows: number;
  duplicatedRows: number;
  warningRows: number;
  failedRows: number;
  processingMs: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  marketplaceAccount: { displayName: string };
  createdBy: { name: string; email: string } | null;
}

interface Row {
  id: string;
  physicalRowNumber: number;
  logicalRowNumber: number;
  externalOrderId: string | null;
  externalReference: string | null;
  processingStatus: ImportRowStatus;
  canonicalHash: string;
  warnings: { message: string }[] | null;
  errors: { message: string }[] | null;
  rawPayload: { headers: string[]; values: string[] };
}

const ROW_BADGE: Record<string, string> = {
  IMPORTED: 'b-ok',
  DUPLICATE: 'b-neutral',
  UPDATED: 'b-info',
  WARNING: 'b-warn',
  ERROR: 'b-err',
  SKIPPED: 'b-neutral',
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: 'Todas' },
  { key: 'IMPORTED', label: 'Importadas' },
  { key: 'DUPLICATE', label: 'Duplicadas' },
  { key: 'UPDATED', label: 'Atualizadas' },
  { key: 'issue:warning', label: 'Com alerta' },
  { key: 'issue:error', label: 'Com erro' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="lbl" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 3 }}>{children}</div>
    </div>
  );
}

export default function LoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState(false);

  const canImport = user?.role === 'ADMIN' || user?.role === 'FINANCIAL';

  const loadBatch = useCallback(() => {
    api.get<Batch>(`/imports/${id}`).then(setBatch);
  }, [id]);

  const loadRows = useCallback(() => {
    setLoading(true);
    let q = `/imports/${id}/rows`;
    if (filter.startsWith('issue:')) q += `?issue=${filter.slice(6)}`;
    else if (filter) q += `?status=${filter}`;
    api
      .get<{ total: number; items: Row[] }>(q)
      .then((r) => {
        setRows(r.items);
        setTotal(r.total);
      })
      .finally(() => setLoading(false));
  }, [id, filter]);

  useEffect(() => { loadBatch(); }, [loadBatch]);
  useEffect(() => { loadRows(); }, [loadRows]);

  async function reprocess() {
    if (!confirm('Reprocessar este lote com o mesmo arquivo? A operação é idempotente e não duplica dados.')) return;
    setReprocessing(true);
    try {
      await api.post(`/imports/${id}/reprocess`, {});
      loadBatch();
      loadRows();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao reprocessar');
    } finally {
      setReprocessing(false);
    }
  }

  if (!batch) return <div className="empty">Carregando…</div>;

  const period =
    (batch.periodStart ? new Date(batch.periodStart).toLocaleDateString('pt-BR') : '—') +
    ' → ' +
    (batch.periodEnd ? new Date(batch.periodEnd).toLocaleDateString('pt-BR') : '—');

  return (
    <>
      <div className="page-head">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/importacoes" className="btn-sm">← Voltar</Link>
            {batch.originalFilename}
          </h2>
          <p>{REPORT_TYPE_LABELS[batch.reportType]} · {batch.marketplaceAccount.displayName} · {dateBR(batch.createdAt)}</p>
        </div>
        {canImport && (
          <button className="btn-sm" onClick={reprocess} disabled={reprocessing}>
            {reprocessing ? 'Reprocessando…' : '↻ Reprocessar'}
          </button>
        )}
      </div>

      {/* Resultado — números reais */}
      <div className="kpi-grid">
        <div className="kpi"><div className="lbl">Linhas de dados</div><div className="val">{batch.dataRowCount}</div><div className="sub">{batch.physicalRowCount} físicas</div></div>
        <div className="kpi"><div className="lbl">Válidas</div><div className="val">{batch.validRows}</div></div>
        <div className="kpi"><div className="lbl">Importadas</div><div className="val" style={{ color: 'var(--ok)' }}>{batch.importedRows}</div></div>
        <div className="kpi"><div className="lbl">Já existentes</div><div className="val">{batch.duplicatedRows}</div></div>
        <div className="kpi"><div className="lbl">Atualizadas</div><div className="val" style={{ color: 'var(--info)' }}>{batch.updatedRows}</div></div>
        <div className="kpi"><div className="lbl">Com alerta</div><div className="val" style={{ color: 'var(--warn)' }}>{batch.warningRows}</div></div>
        <div className="kpi"><div className="lbl">Com erro</div><div className="val" style={{ color: batch.failedRows ? 'var(--err)' : undefined }}>{batch.failedRows}</div></div>
        <div className="kpi"><div className="lbl">Tempo</div><div className="val" style={{ fontSize: 18 }}>{batch.processingMs != null ? `${batch.processingMs} ms` : '—'}</div></div>
      </div>

      <div className="panel">
        <div className="ph"><h3>Detalhes do lote</h3>
          <span className={`badge ${batch.status.includes('ERROR') ? 'b-warn' : batch.status === 'COMPLETED' ? 'b-ok' : 'b-info'}`}>{IMPORT_BATCH_STATUS_LABELS[batch.status as keyof typeof IMPORT_BATCH_STATUS_LABELS] ?? batch.status}</span>
        </div>
        <div className="pb" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 16 }}>
          <Field label="Nome original">{batch.originalFilename}</Field>
          <Field label="Tipo do relatório">{REPORT_TYPE_LABELS[batch.reportType]}{batch.reportTypeManualOverride && ' (ajustado)'}</Field>
          <Field label="Detecção automática">{REPORT_TYPE_LABELS[batch.detectedReportType]} · {(batch.reportTypeConfidence * 100).toFixed(0)}%</Field>
          <Field label="Loja">{batch.marketplaceAccount.displayName}</Field>
          <Field label="Formato real">{batch.fileFormat} {batch.extensionMismatch && <span className="badge b-warn" style={{ marginLeft: 4 }}>extensão .{batch.declaredExtension}</span>}</Field>
          <Field label="Aba">{batch.sheetName ?? '—'}</Field>
          <Field label="Cabeçalho">linha {batch.headerRowIndex ?? '—'}</Field>
          <Field label="Início dos dados">linha {batch.dataStartRowIndex ?? '—'}</Field>
          <Field label="Colunas">{batch.columnCount}</Field>
          <Field label="Período coberto">{period}</Field>
          <Field label="Hash do arquivo"><span className="mono" title={batch.fileHash}>{batch.fileHash.slice(0, 16)}…</span></Field>
          <Field label="Enviado por">{batch.createdBy?.name ?? '—'}</Field>
        </div>
      </div>

      <div className="panel">
        <div className="ph"><h3>Linhas ({total})</h3></div>
        <div className="pb">
          <div className="toolbar">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`btn-sm ${filter === f.key ? 'primary' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="empty">Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="empty">Nenhuma linha para este filtro.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Linha física</th>
                    <th>Linha lógica</th>
                    <th>Status</th>
                    <th>ID do pedido</th>
                    <th>Referência</th>
                    <th>Alertas / erros</th>
                    <th>Hash canônico</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.physicalRowNumber}</td>
                      <td>{r.logicalRowNumber}</td>
                      <td><span className={`badge ${ROW_BADGE[r.processingStatus] ?? 'b-neutral'}`}>{IMPORT_ROW_STATUS_LABELS[r.processingStatus]}</span></td>
                      <td className="mono">{r.externalOrderId ?? '—'}</td>
                      <td className="mono">{r.externalReference ?? '—'}</td>
                      <td>
                        {(r.errors ?? []).map((e, i) => <div key={`e${i}`} style={{ color: 'var(--err)', fontSize: 12 }}>{e.message}</div>)}
                        {(r.warnings ?? []).map((w, i) => <div key={`w${i}`} style={{ color: 'var(--warn)', fontSize: 12 }}>{w.message}</div>)}
                        {!r.errors && !r.warnings && '—'}
                      </td>
                      <td className="mono" title={r.canonicalHash}>{r.canonicalHash.slice(0, 12)}…</td>
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
