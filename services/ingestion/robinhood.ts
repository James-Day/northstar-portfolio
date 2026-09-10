import { parse } from 'csv-parse/sync';
import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import { isoDate, type IsoDate } from '@/lib/domain/types';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;

export const ROBINHOOD_ACTIVITY_PARSER_VERSION = 'robinhood-activity-v1';

export type RobinhoodActivityType = 'buy' | 'sell' | 'dividend' | 'drip_buy' | 'interest' | 'fee' | 'deposit' | 'withdrawal' | 'ira_incentive' | 'transfer_in' | 'transfer_out';

export type ParsedRobinhoodRow = {
  rowNumber: number;
  raw: Record<string, string>;
  status: 'supported' | 'unsupported' | 'invalid';
  message?: string;
  activity?: {
    effectiveDate: IsoDate;
    type: RobinhoodActivityType;
    symbol: string | null;
    quantity: DecimalString | null;
    price: DecimalString | null;
    amount: DecimalString;
    description: string;
  };
};

const transactionCodes: Record<string, RobinhoodActivityType> = {
  BUY: 'buy',
  SELL: 'sell',
  DIVIDEND: 'dividend',
  'CASH DIVIDEND': 'dividend',
  'DIVIDEND REINVESTMENT': 'drip_buy',
  'DIVIDEND REINVEST': 'drip_buy',
  CDIV: 'dividend',
  MDIV: 'dividend',
  INTEREST: 'interest',
  SLIP: 'interest',
  FEE: 'fee',
  AFEE: 'fee',
  'ACH DEPOSIT': 'deposit',
  'ACH WITHDRAWAL': 'withdrawal',
  'IRA CONTRIBUTION': 'deposit',
  'IRA DISTRIBUTION': 'withdrawal',
  'IRA INCENTIVE': 'ira_incentive',
  'TRANSFER IN': 'transfer_in',
  'TRANSFER OUT': 'transfer_out',
};

function normalizedHeader(header: string) { return header.trim().toLowerCase(); }

function transactionTypeFor(code: string, description: string): RobinhoodActivityType | undefined {
  if (code === 'ACH') {
    const normalizedDescription = description.trim().toUpperCase();
    if (normalizedDescription === 'ACH DEPOSIT') return 'deposit';
    if (normalizedDescription === 'ACH WITHDRAWAL') return 'withdrawal';
    return undefined;
  }
  return transactionCodes[code];
}

function parseDate(value: string): IsoDate {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return isoDate(trimmed);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!match) throw new Error(`Invalid activity date: ${value}`);
  return isoDate(`${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`);
}

function parseDecimal(value: string, field: string, allowBlank = false): DecimalString | null {
  const trimmed = value.trim();
  if (!trimmed && allowBlank) return null;
  const parenthetical = trimmed.startsWith('(') && trimmed.endsWith(')');
  const stripped = (parenthetical ? trimmed.slice(1, -1) : trimmed).replace(/[$,]/g, '');
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(stripped)) throw new Error(`Invalid ${field}: ${value}`);
  const result = decimalString(stripped);
  return parenthetical ? decimalString(new Decimal(result).abs().negated().toFixed()) : result;
}

function directedAmount(type: RobinhoodActivityType, amount: DecimalString): DecimalString {
  const magnitude = new Decimal(amount).abs();
  return decimalString((['buy', 'drip_buy', 'fee', 'withdrawal', 'transfer_out'].includes(type) ? magnitude.negated() : magnitude).toFixed());
}

/**
 * Parses an official Robinhood activity CSV into immutable review rows.
 * Transaction codes are matched exactly; unfamiliar codes remain unsupported.
 */
export function parseRobinhoodActivityCsv(csv: string): ParsedRobinhoodRow[] {
  if (Buffer.byteLength(csv, 'utf8') > MAX_BYTES) throw new Error('CSV exceeds the 10 MB import limit.');
  const records = parse(csv, {
    bom: true,
    columns: (headers: string[]) => {
      const normalized = headers.map(normalizedHeader);
      if (new Set(normalized).size !== normalized.length) throw new Error('CSV has duplicate column headers.');
      return normalized;
    },
    skip_empty_lines: true,
    trim: true,
    relax_quotes: false,
    // Robinhood appends an informational footer with one additional column.
    // The mapped data columns are blank, so it is ignored below with other
    // fully blank records. Transaction content is still validated per row.
    relax_column_count: true,
  }) as Record<string, string>[];
  if (records.length === 0) throw new Error('CSV needs a header and at least one activity row.');
  if (records.length > MAX_ROWS) throw new Error('CSV exceeds the 50,000-row import limit.');

  const headerSet = new Set(Object.keys(records[0]));
  for (const required of ['activity date', 'trans code', 'amount']) {
    if (!headerSet.has(required)) throw new Error(`Robinhood CSV is missing the required ${required} column.`);
  }

  return records.flatMap<ParsedRobinhoodRow>((raw, index) => {
    const rowNumber = index + 2;
    if (Object.values(raw).every((value) => !value.trim())) return [];
    const code = raw['trans code'].trim().toUpperCase();
    const type = transactionTypeFor(code, raw.description ?? '');
    if (!type) return [{ rowNumber, raw, status: 'unsupported', message: `Unsupported Robinhood transaction code: ${raw['trans code'] || '(blank)'}.` }];
    try {
      const symbol = raw.instrument?.trim().toUpperCase() || null;
      const quantity = parseDecimal(raw.quantity ?? raw['quantity transacted'] ?? '', 'quantity', true);
      const price = parseDecimal(raw.price ?? raw['price per share'] ?? '', 'price', true);
      const amount = parseDecimal(raw.amount, 'amount');
      if (['buy', 'sell', 'drip_buy'].includes(type) && (!symbol || !quantity || new Decimal(quantity).lte(0))) {
        throw new Error(`Row ${rowNumber} requires an instrument and positive quantity for ${type}.`);
      }
      return [{
        rowNumber,
        raw,
        status: 'supported',
        activity: {
          effectiveDate: parseDate(raw['activity date']),
          type,
          symbol,
          quantity,
          price,
          amount: directedAmount(type, amount!),
          description: raw.description?.trim() || raw['trans code'].trim(),
        },
      }];
    } catch (error) {
      return [{
        rowNumber,
        raw,
        status: 'invalid',
        message: error instanceof Error ? error.message : `Row ${rowNumber} is invalid.`,
      }];
    }
  });
}
