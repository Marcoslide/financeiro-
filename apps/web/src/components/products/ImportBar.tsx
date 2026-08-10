'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ProductImportSummary } from '@financeiro/shared';
import { api } from '@/lib/api';
import { dateBR } from '@/lib/format';

/**
 * Barra compacta de atualização do catálogo (prompt §3). O upload real continua,
 * mas como uma ferramenta discreta dentro do sistema — sem dominar a tela.
 */
export function ImportBar({
  accountId,
  products,
  variations,
  lastImportAt,
  onDone,
}: {
  accountId: string;
  products: number;
  variations: number;
  lastImportAt: string | null;
  onDone: (summary: ProductImportSummary) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="importbar">
      <div>
        <div className="ib-title">Atualizar catálogo Shopee</div>
        <div className="ib-meta">
          {lastImportAt ? <>Última atualização: {dateBR(lastImportAt)} · </> : null}
          {products.toLocaleString('pt-BR')} anúncios · {variations.toLocaleString('pt-BR')} variações
        </div>
      </div>
      <div className="spacer" />
      <Link className="link-btn" href="/produtos/importacoes">Ver histórico</Link>
      <button className="btn-sm primary" onClick={() => setOpen(true)}>Importar planilha</button>
      {open && (
        <ImportModal
          accountId={accountId}
          onClose={() => setOpen(false)}
          onDone={(s) => { setOpen(false); onDone(s); }}
        />
      )}
    </div>
  );
}

function ImportModal({
  accountId, onClose, onDone,
}: {
  accountId: string;
  onClose: () => void;
  onDone: (s: ProductImportSummary) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function doImport() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('marketplaceAccountId', accountId);
      form.append('file', file);
      const res = await api.upload<ProductImportSummary>('/products/import', form);
      onDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar a planilha');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>Importar planilha da Shopee</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="mbd">
          {error && <div className="form-err" style={{ marginBottom: 12 }}>{error}</div>}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
            style={{
              border: `2px dashed ${dragOver ? 'var(--brand-2)' : 'var(--line)'}`,
              borderRadius: 12, padding: 26, textAlign: 'center', cursor: 'pointer',
              background: dragOver ? '#f0f4ff' : '#fbfcfe',
            }}
          >
            <div style={{ fontSize: 26, opacity: 0.4 }}>⭱</div>
            {file ? (
              <div style={{ marginTop: 6 }}><b>{file.name}</b><div className="footnote" style={{ marginTop: 2 }}>{(file.size / 1024).toFixed(0)} KB</div></div>
            ) : (
              <div className="footnote" style={{ marginTop: 6 }}>Arraste o arquivo .xlsx ou clique para selecionar</div>
            )}
            <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="footnote">Reimportar sincroniza preço e estoque sem duplicar; família e preço de fechamento são preservados.</div>
        </div>
        <div className="mf">
          <button className="btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn-sm primary" disabled={!file || loading} onClick={doImport}>{loading ? 'Importando…' : 'Importar'}</button>
        </div>
      </div>
    </div>
  );
}
