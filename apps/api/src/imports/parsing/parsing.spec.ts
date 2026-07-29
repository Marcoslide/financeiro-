import { describe, expect, it } from 'vitest';
import { ReportType } from '@financeiro/shared';
import {
  cleanId,
  parseDate,
  parseDecimal,
  parsePercent,
  parseIntSafe,
  excelSerialToDate,
} from './value-parsers';
import { detectFileFormat, isExtensionMismatch } from './format';
import { FileFormat } from '@financeiro/shared';
import { parseCsv, sniffDelimiter, decodeText } from './workbook';
import { processRow } from './index';
import { getReportSpec } from './report-specs';
import { reportTypeFromFilename } from './detect';
import * as fs from 'fs';
import * as path from 'path';
import { parseFile } from './analyze';

describe('parseDecimal — três formatos monetários reais', () => {
  it('ponto decimal simples', () => {
    expect(parseDecimal('331.08').decimal).toBe('331.08');
    expect(parseDecimal('58.00').decimal).toBe('58.00');
    expect(parseDecimal('1749.23').decimal).toBe('1749.23');
  });
  it('negativo da carteira', () => {
    expect(parseDecimal('-44.31').decimal).toBe('-44.31');
    expect(parseDecimal('-0.64').decimal).toBe('-0.64');
  });
  it('prefixo R$ com ponto (Acelera)', () => {
    expect(parseDecimal('R$99.54').decimal).toBe('99.54');
    expect(parseDecimal('R$1749.23').decimal).toBe('1749.23');
  });
  it('prefixo R$ com vírgula BR (Devoluções)', () => {
    expect(parseDecimal('R$331,08').decimal).toBe('331.08');
    expect(parseDecimal('R$0,00').decimal).toBe('0.00');
  });
  it('milhar BR com vírgula decimal', () => {
    expect(parseDecimal('R$1.234,56').decimal).toBe('1234.56');
    expect(parseDecimal('253.489,29').decimal).toBe('253489.29');
  });
  it('nulos viram null sem erro', () => {
    expect(parseDecimal('-').decimal).toBeNull();
    expect(parseDecimal('--').decimal).toBeNull();
    expect(parseDecimal('').decimal).toBeNull();
  });
});

describe('parsePercent', () => {
  it('100% => 1', () => expect(parsePercent('100%').decimal).toBe('1'));
  it('50% => 0.5', () => expect(parsePercent('50%').decimal).toBe('0.5'));
});

describe('parseDate — três granularidades + serial + texto', () => {
  it('data+hora+seg', () => {
    const d = parseDate('2026-07-28 10:38:41');
    expect(d.date?.toISOString()).toBe('2026-07-28T13:38:41.000Z'); // -03:00
  });
  it('data+hora', () => {
    expect(parseDate('2026-07-17 21:46').date).not.toBeNull();
  });
  it('só data', () => {
    expect(parseDate('2026-07-01').date).not.toBeNull();
  });
  it('serial do Excel', () => {
    const raw = 46203; // ~2026
    const d = parseDate('', raw);
    expect(d.date?.getUTCFullYear()).toBe(2026);
    expect(excelSerialToDate(raw).getUTCFullYear()).toBe(2026);
  });
});

describe('cleanId — não perde zeros nem quebra a guarda do Excel', () => {
  it('="219..." vira dígitos', () => {
    expect(cleanId('="2193185766133548046"')).toBe('2193185766133548046');
  });
  it('preserva zeros à esquerda', () => {
    expect(cleanId('007700123')).toBe('007700123');
    expect(cleanId('="00042"')).toBe('00042');
  });
  it('id alfanumérico do pedido', () => {
    expect(cleanId('260722CC5B1RNV')).toBe('260722CC5B1RNV');
  });
});

describe('parseIntSafe', () => {
  it('inteiro', () => expect(parseIntSafe('3')).toBe(3));
  it('nulo', () => expect(parseIntSafe('--')).toBeNull());
});

describe('detecção de formato por conteúdo', () => {
  it('PK => XLSX', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(detectFileFormat(buf)).toBe(FileFormat.XLSX);
  });
  it('OLE2 => XLS', () => {
    const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]);
    expect(detectFileFormat(buf)).toBe(FileFormat.XLS);
  });
  it('texto => CSV', () => {
    expect(detectFileFormat(Buffer.from('a,b,c\n1,2,3'))).toBe(FileFormat.CSV);
  });
  it('.xls que é XLSX => mismatch', () => {
    expect(isExtensionMismatch(FileFormat.XLSX, 'xls')).toBe(true);
    expect(isExtensionMismatch(FileFormat.XLSX, 'xlsx')).toBe(false);
  });
});

describe('CSV parser', () => {
  it('respeita aspas e vírgula interna', () => {
    const rows = parseCsv('a,"b,c",d\n1,2,3', ',');
    expect(rows[0]).toEqual(['a', 'b,c', 'd']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });
  it('sniff de delimitador', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
  });
});

describe('encoding — CSV Latin-1/Windows-1252 é decodificado corretamente', () => {
  it('acentos em latin1 não viram caractere de substituição', () => {
    const latin1 = Buffer.from('Descrição;Comissão;Endereço\naçaí;ção;coração', 'latin1');
    const text = decodeText(latin1);
    expect(text).toContain('Descrição');
    expect(text).toContain('coração');
    expect(text).not.toContain('�');
  });
  it('UTF-8 com BOM é lido sem o BOM', () => {
    const utf8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b,c', 'utf8')]);
    expect(decodeText(utf8bom).startsWith('a')).toBe(true);
  });
});

describe('desambiguação por nome de arquivo (desempate na família de pedidos)', () => {
  const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../../test/fixtures/files', f));
  it('mapa de palavras-chave', () => {
    expect(reportTypeFromFilename('Order.cancelled.xlsx')).toBe(ReportType.ORDER_CANCELLATION);
    expect(reportTypeFromFilename('Order.failed_delivery.xlsx')).toBe(ReportType.FAILED_DELIVERY);
    expect(reportTypeFromFilename('Order.toship.xlsx')).toBe(ReportType.ORDERS);
  });
  it('arquivo de pedidos renomeado como failed_delivery é detectado como Falha', () => {
    const parsed = parseFile(read('Order.toship.20260729.xlsx'), 'Order.failed_delivery.20260729.xlsx');
    expect(parsed.reportType).toBe(ReportType.FAILED_DELIVERY);
  });
  it('conteúdo decisivo vence o nome: arquivo com "Cancelar Motivo" é sempre Cancelamento', () => {
    const parsed = parseFile(read('Order.cancelled.20260729.xlsx'), 'nome_enganoso_toship.xlsx');
    expect(parsed.reportType).toBe(ReportType.ORDER_CANCELLATION);
  });
});

describe('hash canônico — duas movimentações legítimas do mesmo pedido/dia diferem', () => {
  it('carteira: crédito e débito no mesmo dia/valor têm hashes distintos', () => {
    const spec = getReportSpec(ReportType.WALLET_TRANSACTION)!;
    const headers = ['Data', 'Tipo de transação', 'Descrição', 'ID do pedido', 'Direção do dinheiro', 'Valor', 'Status', 'Balança após as transações', 'Valor a Ser Ajustado'];
    const mk = (dir: string, amount: string, bal: string) => ({
      physicalRowNumber: 1,
      logicalRowNumber: 1,
      headerNames: headers,
      values: ['2026-07-10 10:00:00', 'Renda do pedido', 'x', '260722CC5B1RNV', dir, amount, 'ok', bal, ''],
      cells: ['2026-07-10 10:00:00', 'Renda do pedido', 'x', '260722CC5B1RNV', dir, amount, 'ok', bal, ''].map((t) => ({ text: t, raw: t })),
    });
    const a = processRow(spec, mk('Entrada', '100.00', '500.00'));
    const b = processRow(spec, mk('Saída', '100.00', '400.00'));
    expect(a.canonicalHash).not.toBe(b.canonicalHash);
  });
});
