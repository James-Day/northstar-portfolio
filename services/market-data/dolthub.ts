import { z } from 'zod';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import { isoDate, type IsoDate } from '@/lib/domain/types';

const API_BASE_URL = 'https://www.dolthub.com/api/v1alpha1/post-no-preference/stocks';
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.\-]{0,14}$/;

const queryResponse = z.object({
  query_execution_status: z.enum(['Success', 'Error']),
  query_execution_message: z.string(),
  repository_owner: z.string(),
  repository_name: z.string(),
  commit_ref: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export type DoltHubDailyClose = {
  symbol: string;
  tradingDate: IsoDate;
  close: DecimalString;
  source: 'dolthub';
  sourceRevision: string;
};

export type DoltHubCloseCursor = {
  tradingDate: IsoDate;
  symbol: string;
};

export type DoltHubClosePage = {
  records: DoltHubDailyClose[];
  sourceRevision: string;
  nextCursor: DoltHubCloseCursor | null;
};

export type DoltHubHistoricalSourceOptions = {
  fetcher?: typeof fetch;
  baseUrl?: string;
  branch?: string;
};

/**
 * Reads a bounded page of unadjusted EOD closes from the public DoltHub source.
 * The source's branch is checked before and after each page so we never label a
 * result with a revision that changed while it was being read.
 */
export class DoltHubHistoricalSource {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly branch: string;

  constructor(options: DoltHubHistoricalSourceOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = options.baseUrl ?? API_BASE_URL;
    this.branch = options.branch ?? 'master';
    if (!/^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(this.branch)) throw new Error('Invalid DoltHub branch name.');
  }

  async getDailyClosePage(input: { symbols: string[]; from: IsoDate; through: IsoDate; limit?: number; cursor?: DoltHubCloseCursor }): Promise<DoltHubClosePage> {
    if (input.from > input.through) throw new Error('Historical price range must end on or after its start.');
    const symbols = normalizeSymbols(input.symbols);
    if (symbols.length === 0) return { records: [], sourceRevision: await this.getCurrentRevision(), nextCursor: null };
    const limit = input.limit ?? 1_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5_000) throw new Error('Historical price page limit must be an integer from 1 to 5000.');
    const cursor = input.cursor ? { tradingDate: isoDate(input.cursor.tradingDate), symbol: normalizeSymbols([input.cursor.symbol])[0] } : null;

    const revisionBefore = await this.getCurrentRevision();
    const quotedSymbols = symbols.map((symbol) => `'${symbol}'`).join(', ');
    const sql = [
      'SELECT date, act_symbol, close FROM ohlcv',
      `WHERE act_symbol IN (${quotedSymbols})`,
      `AND date >= '${input.from}' AND date <= '${input.through}'`,
      ...(cursor ? [`AND (date > '${cursor.tradingDate}' OR (date = '${cursor.tradingDate}' AND act_symbol > '${cursor.symbol}'))`] : []),
      'AND close IS NOT NULL',
      'ORDER BY date ASC, act_symbol ASC',
      `LIMIT ${limit}`,
    ].join(' ');
    const response = await this.query(sql);
    const revisionAfter = await this.getCurrentRevision();
    if (revisionBefore !== revisionAfter) throw new Error('DoltHub source changed during the historical-price read; retry the page.');

    const records = response.rows.map((row) => toDailyClose(row, revisionBefore));
    const lastRecord = records.at(-1);
    return {
      sourceRevision: revisionBefore,
      records,
      nextCursor: records.length === limit && lastRecord ? { tradingDate: lastRecord.tradingDate, symbol: lastRecord.symbol } : null,
    };
  }

  private async getCurrentRevision(): Promise<string> {
    const response = await this.query('SELECT commit_hash FROM dolt_log LIMIT 1');
    const revision = response.rows[0]?.commit_hash;
    if (typeof revision !== 'string' || !revision) throw new Error('DoltHub returned no source revision.');
    return revision;
  }

  private async query(sql: string): Promise<z.infer<typeof queryResponse>> {
    const url = new URL(`${this.baseUrl}/${this.branch}`);
    url.searchParams.set('q', sql);
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`DoltHub returned HTTP ${response.status}.`);
    const payload = queryResponse.parse(await response.json());
    if (payload.query_execution_status !== 'Success') throw new Error(`DoltHub query failed: ${payload.query_execution_message || 'unknown error'}`);
    return payload;
  }
}

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].map((symbol) => {
    if (!SYMBOL_PATTERN.test(symbol)) throw new Error(`Invalid market-data symbol: ${symbol}`);
    return symbol;
  });
}

function toDailyClose(row: Record<string, unknown>, sourceRevision: string): DoltHubDailyClose {
  if (typeof row.date !== 'string' || typeof row.act_symbol !== 'string' || (typeof row.close !== 'string' && typeof row.close !== 'number')) {
    throw new Error('DoltHub returned an invalid daily-close record.');
  }
  return {
    symbol: normalizeSymbols([row.act_symbol])[0],
    tradingDate: isoDate(row.date),
    close: decimalString(row.close),
    source: 'dolthub',
    sourceRevision,
  };
}
