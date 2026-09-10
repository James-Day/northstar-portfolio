import { parse } from 'csv-parse/sync';
import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import { isoDate, type IsoDate } from '@/lib/domain/types';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;

export const ROBINHOOD_ACTIVITY_PARSER_VERSION = 'robinhood-activity-v2';

export type RobinhoodActivityType = 'buy' | 'sell' | 'dividend' | 'drip_buy' | 'interest' | 'fee' | 'deposit' | 'withdrawal' | 'ira_incentive' | 'transfer_in' | 'transfer_out' | 'split';

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
    corporateAction?: {
      type: 'split';
      ratioNumerator: DecimalString;
      ratioDenominator: DecimalString;
    };
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
  SPL: 'split',
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

  const parsedRows = records.flatMap<ParsedRobinhoodRow>((raw, index) => {
    const rowNumber = index + 2;
    if (Object.values(raw).every((value) => !String(value ?? '').trim())) return [];
    const code = (raw['trans code'] ?? '').trim().toUpperCase();
    const type = transactionTypeFor(code, raw.description ?? '');
    if (!type) {
      const symbol = raw.instrument?.trim().toUpperCase();
      const message = code === 'SPL'
        ? `Stock split${symbol ? ` for ${symbol}` : ''} requires corporate-action review before this import can be committed.`
        : `Unsupported Robinhood transaction code: ${raw['trans code'] || '(blank)'}.`;
      return [{ rowNumber, raw, status: 'unsupported', message }];
    }
    try {
      const symbol = raw.instrument?.trim().toUpperCase() || null;
      const quantity = parseDecimal(raw.quantity ?? raw['quantity transacted'] ?? '', 'quantity', true);
      const price = parseDecimal(raw.price ?? raw['price per share'] ?? '', 'price', true);
      const amount = type === 'split' ? decimalString('0') : parseDecimal(raw.amount, 'amount');
      if (['buy', 'sell', 'drip_buy', 'split'].includes(type) && (!symbol || !quantity || new Decimal(quantity).lte(0))) {
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
  return resolveSplitRows(parsedRows);
}

/**
 * Robinhood's SPL quantity is the number of shares added by the split, rather
 * than a ratio. Infer the ratio only when the preceding buy/sell history gives
 * us an unambiguous positive position; otherwise leave the row blocked.
 */
function resolveSplitRows(rows: ParsedRobinhoodRow[]): ParsedRobinhoodRow[] {
  const positionBySymbol = new Map<string, Decimal>();
  const prePositions = new Map<number, Decimal>();
  const sorted = [...rows].filter((row) => row.status === 'supported' && row.activity).sort((left, right) => left.activity!.effectiveDate.localeCompare(right.activity!.effectiveDate) || left.rowNumber - right.rowNumber);
  for (const row of sorted) {
    const activity = row.activity!;
    if (!activity.symbol || !activity.quantity) continue;
    if (activity.type === 'split') {
      prePositions.set(row.rowNumber, positionBySymbol.get(activity.symbol) ?? new Decimal(0));
    } else if (activity.type === 'buy' || activity.type === 'drip_buy') {
      positionBySymbol.set(activity.symbol, (positionBySymbol.get(activity.symbol) ?? new Decimal(0)).plus(activity.quantity));
    } else if (activity.type === 'sell') {
      positionBySymbol.set(activity.symbol, (positionBySymbol.get(activity.symbol) ?? new Decimal(0)).minus(activity.quantity));
    }
  }
  return rows.map((row) => {
    if (row.status !== 'supported' || row.activity?.type !== 'split' || !row.activity.symbol || !row.activity.quantity) return row;
    const before = prePositions.get(row.rowNumber) ?? new Decimal(0);
    if (before.lte(0)) return { ...row, status: 'unsupported', activity: undefined, message: `Stock split for ${row.activity.symbol} needs a positive pre-split position to infer its ratio.` };
    const ratio = before.plus(row.activity.quantity).div(before);
    if (ratio.lte(1) || !ratio.isInteger()) return { ...row, status: 'unsupported', activity: undefined, message: `Stock split for ${row.activity.symbol} has an ambiguous inferred ratio and requires corporate-action review.` };
    return { ...row, activity: { ...row.activity, corporateAction: { type: 'split', ratioNumerator: decimalString(ratio.toFixed()), ratioDenominator: decimalString('1') } } };
  });
}
