export * from './value-parsers';
export * from './format';
export * from './workbook';
export * from './row-accessor';
export * from './report-specs';
export * from './detect';
export * from './hashing';
export * from './analyze';

import { RowAccessor } from './row-accessor';
import { ParsedRow } from './analyze';
import { ReportSpec } from './report-specs';
import { canonicalRowHash, rawRowHash, CANONICAL_HASH_VERSION } from './hashing';
import { NormalizedRow } from './report-specs';

export interface ProcessedRow {
  physicalRowNumber: number;
  logicalRowNumber: number;
  rawPayload: { headers: string[]; values: string[] };
  normalized: NormalizedRow;
  rawHash: string;
  canonicalHash: string;
  canonicalHashVersion: string;
}

/** Normaliza + calcula hashes de uma linha de dados já parseada. */
export function processRow(spec: ReportSpec, row: ParsedRow): ProcessedRow {
  const accessor = new RowAccessor(row.headerNames, row.cells);
  const normalized = spec.normalize(accessor);
  return {
    physicalRowNumber: row.physicalRowNumber,
    logicalRowNumber: row.logicalRowNumber,
    rawPayload: { headers: row.headerNames, values: row.values },
    normalized,
    rawHash: rawRowHash(row.values),
    canonicalHash: canonicalRowHash(normalized.canonicalParts),
    canonicalHashVersion: CANONICAL_HASH_VERSION,
  };
}
