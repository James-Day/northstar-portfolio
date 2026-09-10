/** Small runtime-neutral RFC 4180 record parser for browser and Worker use. */
export function parseCsvRecords(input: string): string[][] {
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"' && field.length === 0) { quoted = true; continue; }
    if (character === ',') { record.push(field); field = ''; continue; }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      record.push(field); field = '';
      records.push(record);
      record = [];
      continue;
    }
    field += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    if (record.some((value) => value.trim())) records.push(record);
  }
  return records;
}
