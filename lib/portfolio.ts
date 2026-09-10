import { parseRobinhoodActivityCsv, type RobinhoodActivityType } from '@/services/ingestion/robinhood';

export type ActivityKind = 'buy' | 'sell' | 'dividend' | 'drip' | 'deposit' | 'withdrawal' | 'interest' | 'fee' | 'incentive' | 'transfer_in' | 'transfer_out' | 'split' | 'unsupported';

export type Activity = { id: string; date: string; kind: ActivityKind; symbol?: string; quantity?: number; price?: number; amount: number; description: string; source: 'demo' | 'robinhood'; warning?: string };
export type Holding = { symbol: string; name: string; shares: number; costBasis: number; price: number; change: number };
export type PricePoint = { date: string; value: number };

export const demoActivities: Activity[] = [
  { id: '1', date: '2025-01-03', kind: 'deposit', amount: 12000, description: 'ACH deposit', source: 'demo' },
  { id: '2', date: '2025-01-06', kind: 'buy', symbol: 'VTI', quantity: 18, price: 279.12, amount: -5024.16, description: 'Market buy', source: 'demo' },
  { id: '3', date: '2025-01-10', kind: 'buy', symbol: 'MSFT', quantity: 7, price: 420.78, amount: -2945.46, description: 'Market buy', source: 'demo' },
  { id: '4', date: '2025-02-14', kind: 'dividend', symbol: 'VTI', amount: 18.92, description: 'Cash dividend', source: 'demo' },
  { id: '5', date: '2025-03-03', kind: 'buy', symbol: 'NVDA', quantity: 8, price: 119.55, amount: -956.4, description: 'Market buy', source: 'demo' },
  { id: '6', date: '2025-04-01', kind: 'dividend', symbol: 'MSFT', amount: 5.82, description: 'Cash dividend', source: 'demo' },
  { id: '7', date: '2025-05-15', kind: 'sell', symbol: 'NVDA', quantity: 2, price: 138.4, amount: 276.8, description: 'Market sell', source: 'demo' },
  { id: '8', date: '2025-06-20', kind: 'deposit', amount: 1000, description: 'ACH deposit', source: 'demo' },
];

export const demoHoldings: Holding[] = [
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', shares: 18, costBasis: 5024.16, price: 304.18, change: 0.31 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', shares: 7, costBasis: 2945.46, price: 512.09, change: 1.18 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', shares: 6, costBasis: 717.3, price: 183.19, change: 2.42 },
];

export const demoPrices: PricePoint[] = [['Jan', 12000], ['Feb', 12462], ['Mar', 12138], ['Apr', 13274], ['May', 13826], ['Jun', 14088], ['Jul', 14892], ['Aug', 15342], ['Sep', 15780]].map(([date, value]) => ({ date: String(date), value: Number(value) }));

export function parseRobinhoodCsv(csv: string): Activity[] {
  return parseRobinhoodActivityCsv(csv).map((row) => {
    const activity = row.activity;
    const raw = row.raw;
    const kind = activity ? activityKind(activity.type) : 'unsupported';
    return {
      id: `row-${row.rowNumber}`,
      date: activity?.effectiveDate ?? raw['activity date'] ?? '',
      kind,
      symbol: activity?.symbol ?? (raw.instrument?.trim().toUpperCase() || undefined),
      quantity: activity?.quantity ? Number(activity.quantity) : undefined,
      price: activity?.price ? Number(activity.price) : undefined,
      amount: activity ? Number(activity.amount) : 0,
      description: activity?.description ?? raw.description?.trim() ?? raw['trans code']?.trim() ?? 'Imported activity',
      source: 'robinhood',
      warning: row.status === 'supported' ? undefined : row.message ?? 'This activity needs review before it can affect your reports.',
    };
  });
}

function activityKind(type: RobinhoodActivityType): ActivityKind {
  if (type === 'drip_buy') return 'drip';
  if (type === 'ira_incentive') return 'incentive';
  return type;
}

export function calculateSummary(activities: Activity[], holdings: Holding[] = demoHoldings) {
  const holdingsValue = holdings.reduce((sum, holding) => sum + holding.shares * holding.price, 0); const cash = activities.reduce((sum, activity) => sum + activity.amount, 0); const deposits = activities.filter((item) => item.kind === 'deposit').reduce((sum, item) => sum + item.amount, 0); const dividends = activities.filter((item) => item.kind === 'dividend' || item.kind === 'drip').reduce((sum, item) => sum + item.amount, 0); const realized = activities.filter((item) => item.kind === 'sell').reduce((sum, item) => sum + item.amount, 0) - 239.1; const value = holdingsValue + cash;
  return { value, cash, deposits, dividends, realized, gain: value - deposits, returnPercent: ((value - deposits) / deposits) * 100 };
}

export interface DailyPriceProvider { getDailyPrices(symbols: string[], date: string): Promise<{ symbol: string; close: number; provider: string; asOf: string }[]> }
export class MarketstackProvider implements DailyPriceProvider { async getDailyPrices(symbols: string[], date: string) { if (!symbols.length) return []; throw new Error(`Marketstack is not configured. Add MARKETSTACK_API_KEY on the server before requesting ${date} prices.`); } }
