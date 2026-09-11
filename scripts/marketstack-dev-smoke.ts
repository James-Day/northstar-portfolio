import { MarketstackProvider, MonthlyRequestBudget } from '../services/market-data/marketstack.ts';
import { validateMarketstackDevelopmentSmokeRequest } from '../services/platform/marketstack-development.ts';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const symbol = argument('symbol');
const tradingDate = argument('date');
const confirmedAllowance = argument('allowance');
const parsedAllowance = confirmedAllowance === undefined ? undefined : Number(confirmedAllowance);

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
  const prices = await provider.getDailyPrices([request.symbol], request.tradingDate as never);
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
    requestUnits: budget.usedUnits,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Marketstack development smoke fetch failed.');
  process.exitCode = 1;
}
