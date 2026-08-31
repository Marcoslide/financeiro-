export function normalizeScannedCode(value: string): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function looksLikeBrTracking(value: string): boolean {
  return /^BR[A-Z0-9]{6,}$/.test(value);
}

export function spreadsheetSafe(value: unknown): string | number | Date {
  if (value instanceof Date || typeof value === 'number') return value;
  const text = value == null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function normalizeOperationalCode(value: string): string {
  return normalizeScannedCode(value).replace(/[^A-Z0-9_-]/g, '-').slice(0, 40);
}
