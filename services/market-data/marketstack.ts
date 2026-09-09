import { z } from 'zod';
import { decimalString } from '@/lib/domain/money';
import { isoDate, type IsoDate } from '@/lib/domain/types';
import type { DailyPrice, DailyPriceProvider, PriceRequestBudget } from '@/services/market-data/types';

const marketstackResponse = z.object({
  data: z.array(z.object({
    symbol: z.string().min(1),
    date: z.string().min(10),
    close: z.union([z.number(), z.string()]),
    exchange: z.string().optional(),
  })),
  error: z.object({ code: z.union([z.string(), z.number()]).optional(), message: z.string().optional(), type: z.string().optional() }).optional(),
});

export class MonthlyRequestBudget implements PriceRequestBudget {
  private used = 0;

  constructor(private readonly cap: number) {
    if (!Number.isInteger(cap) || cap < 1) throw new Error('Market-data request cap must be a positive integer.');
  }

  reserve(units: number) {
    if (!Number.isInteger(units) || units < 0) throw new Error('Market-data request units must be a non-negative integer.');
    if (this.used + units > this.cap) throw new Error(`Market-data request cap reached (${this.used}/${this.cap}).`);
    this.used += units;
  }

  get usedUnits() { return this.used; }
}

type MarketstackOptions = {
  apiKey: string;
  fetcher?: typeof fetch;
  requestBudget: PriceRequestBudget;
  baseUrl?: string;
};

/** Server-only Marketstack EOD adapter. Do not import this into browser components. */
export class MarketstackProvider implements DailyPriceProvider {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: MarketstackOptions) {
    if (!options.apiKey.trim()) throw new Error('MARKETSTACK_API_KEY is required for Marketstack requests.');
    this.fetcher = options.fetcher ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://api.marketstack.com/v2/eod';
  }

  async getDailyPrices(symbols: string[], date: IsoDate): Promise<DailyPrice[]> {
    const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
    uniqueSymbols.forEach((symbol) => {
      if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)) throw new Error(`Invalid market-data symbol: ${symbol}`);
    });
    this.options.requestBudget.reserve(uniqueSymbols.length);

    const prices: DailyPrice[] = [];
    for (const symbol of uniqueSymbols) prices.push(await this.fetchDailyPrice(symbol, date));
    return prices;
  }

  private async fetchDailyPrice(symbol: string, date: IsoDate): Promise<DailyPrice> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('access_key', this.options.apiKey);
    url.searchParams.set('symbols', symbol);
    url.searchParams.set('date_from', date);
    url.searchParams.set('date_to', date);

    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`Marketstack returned HTTP ${response.status} for ${symbol}.`);
    const payload = marketstackResponse.parse(await response.json());
    if (payload.error) throw new Error(`Marketstack error for ${symbol}: ${payload.error.message ?? payload.error.type ?? 'unknown error'}`);

    const record = payload.data.find((item) => item.symbol.toUpperCase() === symbol && item.date.slice(0, 10) === date);
    if (!record) throw new Error(`Marketstack returned no close for ${symbol} on ${date}.`);
    return {
      symbol,
      tradingDate: isoDate(record.date.slice(0, 10)),
      close: decimalString(String(record.close)),
      provider: 'marketstack',
      providerMetadata: { exchange: record.exchange ?? null, requestedDate: date },
    };
  }
}
