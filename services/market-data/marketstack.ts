import { z } from "zod";
import { decimalString } from "../../lib/domain/money.ts";
import { isoDate, type IsoDate } from "../../lib/domain/types.ts";
import type {
  DailyPrice,
  DailyPriceProvider,
  PriceRequestBudget,
} from "./types.ts";

const marketstackResponse = z.object({
  data: z.array(
    z.object({
      symbol: z.string().min(1),
      date: z.string().min(10),
      close: z.union([z.number(), z.string()]),
      exchange: z.string().optional(),
    }),
  ),
  error: z
    .object({
      code: z.union([z.string(), z.number()]).optional(),
      message: z.string().optional(),
      type: z.string().optional(),
    })
    .optional(),
});

export class MonthlyRequestBudget implements PriceRequestBudget {
  private used = 0;
  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
    if (!Number.isInteger(cap) || cap < 1)
      throw new Error("Market-data request cap must be a positive integer.");
  }

  reserve(units: number) {
    if (!Number.isInteger(units) || units < 0)
      throw new Error(
        "Market-data request units must be a non-negative integer.",
      );
    if (this.used + units > this.cap)
      throw new Error(
        `Market-data request cap reached (${this.used}/${this.cap}).`,
      );
    this.used += units;
  }

  get usedUnits() {
    return this.used;
  }
}

type MarketstackOptions = {
  apiKey: string;
  fetcher?: typeof fetch;
  requestBudget: PriceRequestBudget;
  baseUrl?: string;
  /** Provider request batch size; quota is still reserved per symbol. */
  maxSymbolsPerRequest?: number;
};

/** Server-only Marketstack EOD adapter. Do not import this into browser components. */
export class MarketstackProvider implements DailyPriceProvider {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly options: MarketstackOptions;

  constructor(options: MarketstackOptions) {
    this.options = options;
    if (!options.apiKey.trim())
      throw new Error(
        "MARKETSTACK_API_KEY is required for Marketstack requests.",
      );
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? "https://api.marketstack.com/v2/eod";
  }

  async getDailyPrices(
    symbols: string[],
    date: IsoDate,
  ): Promise<DailyPrice[]> {
    const uniqueSymbols = [
      ...new Set(
        symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
      ),
    ];
    uniqueSymbols.forEach((symbol) => {
      if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol))
        throw new Error(`Invalid market-data symbol: ${symbol}`);
    });
    const batchSize = this.options.maxSymbolsPerRequest ?? 1;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
      throw new Error(
        "Marketstack batch size must be an integer from 1 through 100.",
      );
    // Validate all local configuration before reserving quota. A malformed
    // batch size must never consume units when no provider request can run.
    this.options.requestBudget.reserve(uniqueSymbols.length);
    const prices: DailyPrice[] = [];
    for (let offset = 0; offset < uniqueSymbols.length; offset += batchSize) {
      prices.push(
        ...(await this.fetchDailyPriceBatch(
          uniqueSymbols.slice(offset, offset + batchSize),
          date,
        )),
      );
    }
    return prices;
  }

  private async fetchDailyPriceBatch(
    symbols: string[],
    date: IsoDate,
  ): Promise<DailyPrice[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("access_key", this.options.apiKey);
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("date_from", date);
    url.searchParams.set("date_to", date);

    const response = await this.fetcher(url);
    if (!response.ok)
      throw new Error(
        `Marketstack returned HTTP ${response.status} for ${symbols.join(", ")}.`,
      );
    const payload = marketstackResponse.parse(await response.json());
    if (payload.error)
      throw new Error(
        `Marketstack error for ${symbols.join(", ")}: ${payload.error.message ?? payload.error.type ?? "unknown error"}`,
      );
    return symbols.map((symbol) => {
      const record = payload.data.find(
        (item) =>
          item.symbol.toUpperCase() === symbol &&
          item.date.slice(0, 10) === date,
      );
      if (!record)
        throw new Error(
          `Marketstack returned no close for ${symbol} on ${date}.`,
        );
      return {
        symbol,
        tradingDate: isoDate(record.date.slice(0, 10)),
        close: decimalString(String(record.close)),
        provider: "marketstack" as const,
        providerMetadata: {
          exchange: record.exchange ?? null,
          requestedDate: date,
        },
      };
    });
  }
}
