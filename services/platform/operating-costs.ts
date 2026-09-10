/**
 * Planning guardrails for the MVP's fixed monthly operating costs.
 *
 * Amounts are integer cents so a budget check cannot be affected by binary
 * floating point rounding. These are estimates, not a billing system; each
 * line item should carry the date and URL used to verify it.
 */
export type CostLineItem = {
  id: string;
  label: string;
  monthlyCents: number;
  sourceUrl?: string;
  verifiedOn?: string;
};

export type MarketstackPlan = {
  id: 'free' | 'basic' | 'professional' | 'business';
  monthlyCents: number;
  includedRequests: number;
  commercialUse: boolean;
  sourceUrl: string;
  verifiedOn: string;
};

export const CURRENT_MARKETSTACK_PLANS: Readonly<Record<MarketstackPlan['id'], MarketstackPlan>> = {
  free: { id: 'free', monthlyCents: 0, includedRequests: 100, commercialUse: false, sourceUrl: 'https://marketstack.com/pricing', verifiedOn: '2026-09-10' },
  basic: { id: 'basic', monthlyCents: 999, includedRequests: 10_000, commercialUse: true, sourceUrl: 'https://marketstack.com/pricing', verifiedOn: '2026-09-10' },
  professional: { id: 'professional', monthlyCents: 4_999, includedRequests: 100_000, commercialUse: true, sourceUrl: 'https://marketstack.com/pricing', verifiedOn: '2026-09-10' },
  business: { id: 'business', monthlyCents: 14_999, includedRequests: 500_000, commercialUse: true, sourceUrl: 'https://marketstack.com/pricing', verifiedOn: '2026-09-10' },
};

export type OperatingCostBudget = {
  targetMaxCents: number;
  escalationCents: number;
  lineItems: readonly CostLineItem[];
  marketstackPlan?: MarketstackPlan;
  expectedMonthlyOverageRequests?: number;
  overageCentsPerRequest?: number;
};

export type OperatingCostAssessment = {
  recurringCents: number;
  marketstackCents: number;
  overageCents: number;
  totalCents: number;
  targetMaxCents: number;
  escalationCents: number;
  status: 'within_target' | 'review' | 'escalate';
  marketstack: { plan: MarketstackPlan['id'] | null; includedRequests: number; expectedOverageRequests: number; commercialUse: boolean };
};

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function validateBudget(input: OperatingCostBudget) {
  nonNegativeInteger(input.targetMaxCents, 'Target budget');
  nonNegativeInteger(input.escalationCents, 'Escalation threshold');
  if (input.escalationCents < input.targetMaxCents) throw new Error('Escalation threshold must be at least the target budget.');
  input.lineItems.forEach((item) => {
    if (!item.id.trim() || !item.label.trim()) throw new Error('Cost line items require an id and label.');
    nonNegativeInteger(item.monthlyCents, `Monthly cost for ${item.id}`);
  });
  nonNegativeInteger(input.expectedMonthlyOverageRequests ?? 0, 'Expected monthly overage requests');
  nonNegativeInteger(input.overageCentsPerRequest ?? 0, 'Overage cost per request');
}

/** Produce the decision used by launch checks and cost dashboards. */
export function assessOperatingCosts(input: OperatingCostBudget): OperatingCostAssessment {
  validateBudget(input);
  const plan = input.marketstackPlan;
  const expectedOverageRequests = input.expectedMonthlyOverageRequests ?? 0;
  const overageCentsPerRequest = input.overageCentsPerRequest ?? 0;
  const recurringCents = input.lineItems.reduce((sum, item) => sum + item.monthlyCents, 0);
  const marketstackCents = plan?.monthlyCents ?? 0;
  const overageCents = expectedOverageRequests * overageCentsPerRequest;
  const totalCents = recurringCents + marketstackCents + overageCents;
  return {
    recurringCents, marketstackCents, overageCents, totalCents,
    targetMaxCents: input.targetMaxCents, escalationCents: input.escalationCents,
    status: totalCents <= input.targetMaxCents ? 'within_target' : totalCents > input.escalationCents ? 'escalate' : 'review',
    marketstack: { plan: plan?.id ?? null, includedRequests: plan?.includedRequests ?? 0, expectedOverageRequests, commercialUse: plan?.commercialUse ?? false },
  };
}

/** Capacity available after retaining a safety reserve for retries and imports. */
export function dailySymbolCapacity(plan: MarketstackPlan, tradingDays = 22, reserveFraction = 0.2): number {
  nonNegativeInteger(tradingDays, 'Trading days');
  if (tradingDays < 1) throw new Error('Trading days must be positive.');
  if (!Number.isFinite(reserveFraction) || reserveFraction < 0 || reserveFraction >= 1) throw new Error('Reserve fraction must be from 0 through less than 1.');
  return Math.floor((plan.includedRequests * (1 - reserveFraction)) / tradingDays);
}
