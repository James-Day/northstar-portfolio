import { MarketstackProvider, MonthlyRequestBudget } from '../services/market-data/marketstack.ts';
import { validateMarketstackDevelopmentSmokeRequest } from '../services/platform/marketstack-development.ts';
import { SupabaseDailyPricesRepository } from '../services/supabase/daily-prices-repository.ts';
import { isoDate } from '../lib/domain/types.ts';
import { loadServerDevVars } from './server-env.ts';

loadServerDevVars();

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const symbol = argument('symbol');
const tradingDate = argument('date');
const confirmedAllowance = argument('allowance');
const parsedAllowance = confirmedAllowance === undefined ? undefined : Number(confirmedAllowance);
const persist = process.argv.includes('--persist');

try {
  if (typeof parsedAllowance !== 'number' || !Number.isInteger(parsedAllowance) || parsedAllowance < 1) {
    throw new Error('Smoke fetch requires --allowance with the confirmed positive monthly allowance.');
  }
  const allowance = parsedAllowance as number;
  const request = validateMarketstackDevelopmentSmokeRequest(
    {
      APP_ENV: process.env.APP_ENV,
      MARKETSTACK_API_KEY: process.env.MARKETSTACK_API_KEY,
      MARKETSTACK_MONTHLY_CAP: process.env.MARKETSTACK_MONTHLY_CAP,
      MARKETSTACK_SCHEDULE_ENABLED: process.env.MARKETSTACK_SCHEDULE_ENABLED,
    },
    { symbol, tradingDate, confirmedAllowance: allowance },
  );
  const budget = new MonthlyRequestBudget(request.monthlyCap);
  const provider = new MarketstackProvider({
    apiKey: process.env.MARKETSTACK_API_KEY!,
    requestBudget: budget,
    maxSymbolsPerRequest: 1,
  });
  const prices = await provider.getDailyPrices([request.symbol], isoDate(request.tradingDate));
  let persisted: { upserted: number } | null = null;
  if (persist) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('--persist requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server-only environment.');
    }
    const repository = new SupabaseDailyPricesRepository({
      supabaseUrl: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    persisted = await repository.persist({ tradingDate: isoDate(request.tradingDate), prices });
    const missing = await repository.getMissingSymbols([request.symbol], request.tradingDate);
    if (missing.length > 0) throw new Error(`Supabase daily price verification found no stored close for ${request.symbol}.`);
  }
  const metadata = prices[0]?.providerMetadata as { exchange?: unknown; requestedDate?: unknown } | undefined;
  console.log(JSON.stringify({
    symbol: request.symbol,
    tradingDate: request.tradingDate,
    close: prices[0]?.close ?? null,
    provider: prices[0]?.provider ?? null,
    providerMetadata: metadata ? {
      exchange: typeof metadata.exchange === 'string' ? metadata.exchange : null,
      requestedDate: typeof metadata.requestedDate === 'string' ? metadata.requestedDate : null,
    } : null,
    persisted,
    requestUnits: budget.usedUnits,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Marketstack development smoke fetch failed.');
  process.exitCode = 1;
}
