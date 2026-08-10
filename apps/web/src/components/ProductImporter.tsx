'use client';

import { useRef, useState } from 'react';
import { ProductImportSummary } from '@financeiro/shared';
import { api } from '@/lib/api';

/**
 * Importador da planilha de produtos da Shopee (prompt §3). Passo único e REAL:
 * envia o .xlsx, o backend localiza o cabeçalho, sincroniza anúncios/variações
 * (sem duplicar, sem destruir dados internos) e devolve o resumo apurado.
 */
export function ProductImporter({
  accountId,
  onDone,
}: {
  accountId: string;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProductImportSummary | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function doImport() {
    if (!file || !accountId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('marketplaceAccountId', accountId);
      form.append('file', file);
      const res = await api.upload<ProductImportSummary>('/products/import', form);
      setResult(res);
      setFile(null);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar a planilha');
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) {
      setFile(f);
      setResult(null);
    }
  }

  return (
    <div className="panel">
      <div className="ph">
        <h3>Importar produtos da Shopee</h3>
        <span className="footnote" style={{ margin: 0 }}>arquivo .xlsx exportado da Shopee</span>
      </div>
      <div className="pb">
        {error && <div className="form-err" style={{ marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              flex: 1,
              minWidth: 280,
              border: `2px dashed ${dragOver ? 'var(--brand-2)' : 'var(--line)'}`,
              borderRadius: 12,
              padding: 24,
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? '#f0f4ff' : '#fbfcfe',
            }}
          >
            <div style={{ fontSize: 28, opacity: 0.4 }}>⭱</div>
            {file ? (
              <div style={{ marginTop: 6 }}>
                <b>{file.name}</b>
                <div className="footnote" style={{ marginTop: 2 }}>{(file.size / 1024).toFixed(0)} KB — clique em Importar</div>
              </div>
            ) : (
              <div className="footnote" style={{ marginTop: 6 }}>Arraste a planilha aqui ou clique para selecionar</div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <button className="btn-sm primary" disabled={!file || loading} onClick={doImport}>
              {loading ? 'Importando…' : 'Importar'}
            </button>
            <span className="footnote" style={{ margin: 0, maxWidth: 200 }}>
              O cabeçalho é localizado pelo conteúdo. Reimportar atualiza estoque e preço, sem duplicar nem apagar família/preço de fechamento.
            </span>
          </div>
        </div>

        {result && (
          <div style={{ marginTop: 16 }}>
            <div className="info-banner" style={{ marginBottom: 12 }}>
              Importação {result.status === 'COMPLETED' ? 'concluída' : 'concluída com erros'}
              {result.alreadyImported ? ' · este arquivo já havia sido importado (sincronizado sem duplicar)' : ''}.
            </div>
            <div className="kpi-grid" style={{ marginBottom: 0 }}>
              <Kpi label="Anúncios identificados" val={result.productsSeen} />
              <Kpi label="Variações identificadas" val={result.variationsSeen} />
              <Kpi label="Novos anúncios" val={result.newProducts} />
              <Kpi label="Novas variações" val={result.newVariations} />
              <Kpi label="Registros atualizados" val={result.updatedRecords} />
              <Kpi label="Sem alteração" val={result.unchangedRecords} />
              <Kpi label="Linhas ignoradas" val={result.ignoredRows} />
              <Kpi label="Erros" val={result.errorRows} danger={result.errorRows > 0} />
            </div>
            {result.errors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button className="btn-sm" onClick={() => setShowErrors((s) => !s)}>
                  {showErrors ? 'Ocultar' : 'Ver'} erros ({result.errors.length})
                </button>
                {showErrors && (
                  <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 10, marginTop: 10 }}>
                    <table>
                      <thead>
                        <tr><th>Linha</th><th>ID do Produto</th><th>SKU</th><th>Erro</th></tr>
                      </thead>
                      <tbody>
                        {result.errors.map((e, i) => (
                          <tr key={i}>
                            <td>{e.physicalRow}</td>
                            <td className="mono">{e.shopeeProductId ?? '—'}</td>
                            <td className="mono">{e.sku ?? '—'}</td>
                            <td>{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, val, danger }: { label: string; val: number; danger?: boolean }) {
  return (
    <div className="kpi">
      <div className="lbl">{label}</div>
      <div className="val" style={danger ? { color: 'var(--err)' } : undefined}>{val}</div>
    </div>
  );
}
