'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ImportAnalysis,
  ImportIssue,
  ReportType,
  REPORT_TYPE_LABELS,
} from '@financeiro/shared';
import { api } from '@/lib/api';

interface Account {
  id: string;
  displayName: string;
}
interface AnalyzeResponse {
  batch: { id: string; originalFilename: string };
  analysis: ImportAnalysis;
}
interface BatchResult {
  id: string;
  importedRows: number;
  updatedRows: number;
  duplicatedRows: number;
  warningRows: number;
  failedRows: number;
  totalRows: number;
  status: string;
}

const REPORT_OPTIONS = (Object.keys(REPORT_TYPE_LABELS) as ReportType[]).filter(
  (t) => t !== ReportType.UNKNOWN && t !== ReportType.WEEKLY_INCOME_STATEMENT,
);

const SEVERITY_CLASS: Record<string, string> = {
  ERROR: 'b-err',
  WARNING: 'b-warn',
  INFO: 'b-info',
};

function IssueList({ issues }: { issues: ImportIssue[] }) {
  if (issues.length === 0) {
    return <div className="footnote" style={{ marginTop: 0 }}>Nenhum alerta. Tudo certo para importar.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {issues.map((i, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span className={`badge ${SEVERITY_CLASS[i.severity] ?? 'b-neutral'}`}>{i.severity}</span>
          <span style={{ fontSize: 13 }}>{i.message}</span>
        </div>
      ))}
    </div>
  );
}

export function ImportWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [batchId, setBatchId] = useState<string>('');
  const [reportType, setReportType] = useState<ReportType>(ReportType.UNKNOWN);
  const [result, setResult] = useState<BatchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Account[]>('/marketplace-accounts').then((rows) => {
      setAccounts(rows);
      if (rows[0]) setAccountId(rows[0].id);
    });
  }, []);

  const previewColumns = useMemo(() => {
    if (!analysis || analysis.previewRows.length === 0) return [];
    return Object.keys(analysis.previewRows[0]).slice(0, 8);
  }, [analysis]);

  async function doAnalyze() {
    if (!file || !accountId) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('marketplaceAccountId', accountId);
      form.append('file', file);
      const res = await api.upload<AnalyzeResponse>('/imports/analyze', form);
      setAnalysis(res.analysis);
      setBatchId(res.batch.id);
      setReportType(res.analysis.detectedReportType);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao analisar o arquivo');
    } finally {
      setLoading(false);
    }
  }

  async function doConfirm() {
    setLoading(true);
    setError(null);
    try {
      const body = reportType && reportType !== ReportType.UNKNOWN ? { reportType } : {};
      const res = await api.post<BatchResult>(`/imports/${batchId}/confirm`, body);
      setResult(res);
      setStep(3);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao confirmar a importação');
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 920, maxWidth: '96vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h3>Nova importação {step > 1 && <span className="footnote" style={{ margin: 0 }}>· etapa {step} de 3</span>}</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <div className="mbd" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          {error && <div className="form-err" style={{ marginBottom: 12 }}>{error}</div>}

          {/* Etapa 1 — loja + arquivo */}
          {step === 1 && (
            <>
              <label className="fld">Loja</label>
              <select className="select" style={{ width: '100%' }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.displayName}</option>
                ))}
              </select>

              <label className="fld" style={{ marginTop: 16 }}>Arquivo (CSV, XLS ou XLSX)</label>
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                style={{
                  border: `2px dashed ${dragOver ? 'var(--brand-2)' : 'var(--line)'}`,
                  borderRadius: 12,
                  padding: 34,
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragOver ? '#f0f4ff' : '#fbfcfe',
                }}
              >
                <div style={{ fontSize: 30, opacity: 0.4 }}>⭱</div>
                {file ? (
                  <div style={{ marginTop: 8 }}><b>{file.name}</b><div className="footnote" style={{ marginTop: 2 }}>{(file.size / 1024).toFixed(0)} KB — clique em Analisar</div></div>
                ) : (
                  <div className="footnote" style={{ marginTop: 8 }}>Arraste o arquivo aqui ou clique para selecionar</div>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="footnote">O tipo de relatório é detectado pelo conteúdo do arquivo, não pela extensão.</div>
            </>
          )}

          {/* Etapa 2 — prévia e confirmação */}
          {step === 2 && analysis && (
            <>
              <div className="kpi-grid" style={{ marginBottom: 14 }}>
                <div className="kpi">
                  <div className="lbl">Relatório sugerido</div>
                  <div className="val" style={{ fontSize: 16 }}>{REPORT_TYPE_LABELS[analysis.detectedReportType]}</div>
                  <div className="sub">confiança {(analysis.reportTypeConfidence * 100).toFixed(0)}%</div>
                </div>
                <div className="kpi">
                  <div className="lbl">Formato real</div>
                  <div className="val" style={{ fontSize: 16 }}>{analysis.fileFormat}</div>
                  <div className="sub">extensão .{analysis.declaredExtension}{analysis.extensionMismatch ? ' (divergente)' : ''}</div>
                </div>
                <div className="kpi">
                  <div className="lbl">Cabeçalho</div>
                  <div className="val" style={{ fontSize: 16 }}>linha {analysis.headerRowIndex ?? '—'}</div>
                  <div className="sub">{analysis.columns.length} colunas · {analysis.dataRowCount} linhas de dados</div>
                </div>
                <div className="kpi">
                  <div className="lbl">Período coberto</div>
                  <div className="val" style={{ fontSize: 14 }}>
                    {analysis.periodStart ? new Date(analysis.periodStart).toLocaleDateString('pt-BR') : '—'}
                    {' → '}
                    {analysis.periodEnd ? new Date(analysis.periodEnd).toLocaleDateString('pt-BR') : '—'}
                  </div>
                </div>
              </div>

              <label className="fld">Tipo do relatório (corrija se necessário)</label>
              <select className="select" style={{ width: '100%' }} value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
                <option value={ReportType.UNKNOWN}>— selecione —</option>
                {REPORT_OPTIONS.map((t) => (
                  <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>
                ))}
              </select>

              <div style={{ marginTop: 16 }}>
                <label className="fld">Alertas</label>
                <IssueList issues={analysis.issues} />
              </div>

              <div style={{ marginTop: 16 }}>
                <label className="fld">Prévia das primeiras linhas</label>
                <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 10 }}>
                  <table>
                    <thead>
                      <tr>{previewColumns.map((c) => <th key={c}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {analysis.previewRows.slice(0, 8).map((row, i) => (
                        <tr key={i}>
                          {previewColumns.map((c) => <td key={c} className="mono">{row[c]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Etapa 3 — resultado */}
          {step === 3 && result && (
            <>
              <div className="info-banner" style={{ marginBottom: 16 }}>
                Importação {result.status === 'COMPLETED' ? 'concluída' : 'concluída com erros'}. Os dados abaixo são reais, apurados no processamento.
              </div>
              <div className="kpi-grid">
                <div className="kpi"><div className="lbl">Importadas</div><div className="val">{result.importedRows}</div></div>
                <div className="kpi"><div className="lbl">Já existentes</div><div className="val">{result.duplicatedRows}</div></div>
                <div className="kpi"><div className="lbl">Atualizadas</div><div className="val">{result.updatedRows}</div></div>
                <div className="kpi"><div className="lbl">Com alerta</div><div className="val">{result.warningRows}</div></div>
                <div className="kpi"><div className="lbl">Com erro</div><div className="val">{result.failedRows}</div></div>
              </div>
            </>
          )}
        </div>

        <div className="mf">
          {step === 1 && (
            <button className="btn-sm primary" disabled={!file || !accountId || loading} onClick={doAnalyze}>
              {loading ? 'Analisando…' : 'Analisar'}
            </button>
          )}
          {step === 2 && (
            <>
              <button className="btn-sm" onClick={() => setStep(1)} disabled={loading}>Voltar</button>
              <button className="btn-sm primary" disabled={loading || reportType === ReportType.UNKNOWN} onClick={doConfirm}>
                {loading ? 'Processando…' : 'Confirmar importação'}
              </button>
            </>
          )}
          {step === 3 && result && (
            <>
              <Link className="btn-sm" href={`/importacoes/${result.id}`} onClick={onClose}>Abrir lote</Link>
              <button className="btn-sm primary" onClick={onClose}>Fechar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
