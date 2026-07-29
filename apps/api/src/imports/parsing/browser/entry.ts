/**
 * Ponto de entrada do bundle de navegador da ferramenta de homologação.
 * Expõe as MESMAS funções do importador real (parseFile/processRow/buildAnalysis)
 * em globalThis.Homolog (no navegador, globalThis === window).
 * Processamento 100% local — nada é enviado para fora.
 */
import { Buffer } from 'buffer';
// Buffer global para o código de leitura (magic bytes, decodificação de texto).
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { parseFile, buildAnalysis, computePeriod } from '../analyze';
import { processRow } from '../index';
import { REPORT_TYPE_LABELS, ReportType } from '@financeiro/shared';

(globalThis as unknown as { Homolog: unknown }).Homolog = {
  parseFile,
  buildAnalysis,
  computePeriod,
  processRow,
  REPORT_TYPE_LABELS,
  ReportType,
  toBuffer: (ab: ArrayBuffer) => Buffer.from(new Uint8Array(ab)),
};
