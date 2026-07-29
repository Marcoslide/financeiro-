import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ReportType } from '@financeiro/shared';
import { parseFile, buildAnalysis, computePeriod } from '../src/imports/parsing/analyze';
import { processRow } from '../src/imports/parsing';

const DIR = path.resolve(__dirname, 'fixtures/files');
const read = (f: string) => fs.readFileSync(path.join(DIR, f));

interface Expectation {
  file: string;
  type: ReportType;
  headerRow: number;
  minDataRows: number;
}

const CASES: Expectation[] = [
  { file: 'Order.toship.20260729.xlsx', type: ReportType.ORDERS, headerRow: 1, minDataRows: 219 },
  { file: 'Order.cancelled.20260729.xlsx', type: ReportType.ORDER_CANCELLATION, headerRow: 1, minDataRows: 346 },
  { file: 'Order.return_refund.20260729.xls', type: ReportType.RETURN_REFUND, headerRow: 1, minDataRows: 150 },
  { file: 'my_balance_transaction_report.20260729.xlsx', type: ReportType.WALLET_TRANSACTION, headerRow: 18, minDataRows: 232 },
  { file: '2193537298992576518_1.csv', type: ReportType.SHOPEE_ACELERA, headerRow: 6, minDataRows: 295 },
  { file: 'SellerOnlinePaymentValidationReport.20260729.csv', type: ReportType.AFFILIATE_COMMISSION, headerRow: 1, minDataRows: 43 },
  { file: 'AMSAffiliatePerformance.20260729.csv', type: ReportType.AFFILIATE_PERFORMANCE, headerRow: 1, minDataRows: 7 },
];

describe('parseFile em todas as fixtures reais sanitizadas', () => {
  for (const c of CASES) {
    it(`${c.file} => ${c.type} (cabeçalho linha ${c.headerRow})`, () => {
      const parsed = parseFile(read(c.file), c.file);
      expect(parsed.reportType).toBe(c.type);
      expect(parsed.headerRowIndex).toBe(c.headerRow);
      expect(parsed.dataRows.length).toBeGreaterThanOrEqual(c.minDataRows);
      // toda linha preserva o payload bruto integralmente
      for (const row of parsed.dataRows.slice(0, 5)) {
        expect(row.values.length).toBeGreaterThanOrEqual(parsed.headerNames.length);
      }
    });
  }

  it('devoluções: extensão .xls mas conteúdo XLSX é detectado por magic bytes', () => {
    const parsed = parseFile(read('Order.return_refund.20260729.xls'), 'Order.return_refund.20260729.xls');
    expect(parsed.format).toBe('XLSX');
    expect(parsed.extensionMismatch).toBe(true);
    const analysis = buildAnalysis(parsed, false);
    expect(analysis.issues.some((i) => i.code === 'EXTENSION_MISMATCH')).toBe(true);
  });

  it('falha na entrega: ambíguo por conteúdo, resolvido pelo nome do arquivo', () => {
    // Sem a dica do nome, o conteúdo é ambíguo → confiança reduzida (~0.7).
    const neutro = parseFile(read('Order.failed_delivery.20260729.xlsx'), 'relatorio.xlsx');
    expect(neutro.reportType).toBe(ReportType.FAILED_DELIVERY);
    expect(neutro.confidence).toBeLessThan(0.8);
    // Com o nome real ("failed_delivery"), a detecção ganha confiança.
    const comNome = parseFile(read('Order.failed_delivery.20260729.xlsx'), 'Order.failed_delivery.20260729.xlsx');
    expect(comNome.reportType).toBe(ReportType.FAILED_DELIVERY);
    expect(comNome.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('carteira: cabeçalho na linha 18 e alerta de offset', () => {
    const parsed = parseFile(read('my_balance_transaction_report.20260729.xlsx'), 'wallet.xlsx');
    const analysis = buildAnalysis(parsed, false);
    expect(analysis.issues.some((i) => i.code === 'HEADER_OFFSET')).toBe(true);
    expect(analysis.periodStart).not.toBeNull();
  });

  it('pedidos: coluna duplicada "Desconto do vendedor" preservada por posição', () => {
    const parsed = parseFile(read('Order.toship.20260729.xlsx'), 'orders.xlsx');
    const dupes = parsed.columns.filter((c) => c.name === 'Desconto do vendedor');
    expect(dupes.length).toBe(2);
  });

  it('acelera: id do resgate ="219..." é limpo sem perder dígitos', () => {
    const parsed = parseFile(read('2193537298992576518_1.csv'), 'acelera.csv');
    const first = processRow(parsed.spec!, parsed.dataRows[0]);
    const rid = first.normalized.identifiers.externalRedemptionId!;
    expect(rid).toMatch(/^\d{19}$/);
    expect(rid).not.toContain('=');
    expect(rid).not.toContain('"');
  });

  it('período coberto é derivado das datas de evento', () => {
    const parsed = parseFile(read('Order.toship.20260729.xlsx'), 'orders.xlsx');
    const { start, end } = computePeriod(parsed);
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(start!.getTime()).toBeLessThanOrEqual(end!.getTime());
  });
});
