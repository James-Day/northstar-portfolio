/** Escapes a value for RFC 4180 CSV and neutralizes spreadsheet formulas. */
export function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers: string[], rows: readonly (readonly unknown[])[]): string {
  if (headers.length === 0) throw new Error('CSV export requires at least one header.');
  for (const row of rows) if (row.length !== headers.length) throw new Error('CSV export row does not match the header count.');
  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}
