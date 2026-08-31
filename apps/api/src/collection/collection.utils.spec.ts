import { describe, expect, it } from 'vitest';
import { looksLikeBrTracking, normalizeOperationalCode, normalizeScannedCode, spreadsheetSafe } from './collection.utils';

describe('collection utils', () => {
  it('normaliza código de scanner sem alterar hífens ou números', () => {
    expect(normalizeScannedCode(' \u200bbr 123-45\r\n')).toBe('BR123-45');
  });

  it('classifica rastreamento BR sem aceitar texto curto', () => {
    expect(looksLikeBrTracking('BR12345678')).toBe(true);
    expect(looksLikeBrTracking('BR12')).toBe(false);
  });

  it('protege células contra fórmula e normaliza código operacional', () => {
    expect(spreadsheetSafe('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(normalizeOperationalCode(' Expedição 01 ')).toBe('EXPEDI--O01');
  });
});
