import { describe, expect, it } from 'vitest';
import { assessOperatingCosts, CURRENT_MARKETSTACK_PLANS, dailySymbolCapacity } from '@/services/platform/operating-costs';

describe('operating cost guardrails', () => {
  it('uses the verified Marketstack allowance and keeps the MVP within target', () => {
    const result = assessOperatingCosts({
      targetMaxCents: 7_500,
      escalationCents: 10_000,
      lineItems: [
        { id: 'supabase', label: 'Supabase', monthlyCents: 2_500 },
        { id: 'cloudflare', label: 'Cloudflare', monthlyCents: 500 },
      ],
      marketstackPlan: CURRENT_MARKETSTACK_PLANS.basic,
    });
    expect(result).toMatchObject({ totalCents: 3_999, status: 'within_target', marketstackCents: 999 });
    expect(result.marketstack).toMatchObject({ plan: 'basic', includedRequests: 10_000, commercialUse: true });
  });

  it('escalates when recurring costs exceed the hard review threshold', () => {
    expect(assessOperatingCosts({ targetMaxCents: 7_500, escalationCents: 10_000, lineItems: [{ id: 'services', label: 'Services', monthlyCents: 10_001 }] }).status).toBe('escalate');
  });

  it('includes documented overage exposure without using floating point money', () => {
    const result = assessOperatingCosts({ targetMaxCents: 7_500, escalationCents: 10_000, lineItems: [], marketstackPlan: CURRENT_MARKETSTACK_PLANS.basic, expectedMonthlyOverageRequests: 10, overageCentsPerRequest: 1 });
    expect(result).toMatchObject({ marketstackCents: 999, overageCents: 10, totalCents: 1_009 });
  });

  it('reserves 20 percent of the verified allowance for retries', () => {
    expect(dailySymbolCapacity(CURRENT_MARKETSTACK_PLANS.basic)).toBe(363);
    expect(dailySymbolCapacity(CURRENT_MARKETSTACK_PLANS.free)).toBe(3);
  });

  it('rejects an inverted budget and invalid overage values', () => {
    expect(() => assessOperatingCosts({ targetMaxCents: 10_000, escalationCents: 7_500, lineItems: [] })).toThrow('Escalation threshold');
    expect(() => assessOperatingCosts({ targetMaxCents: 7_500, escalationCents: 10_000, lineItems: [], expectedMonthlyOverageRequests: -1 })).toThrow('overage requests');
  });
});
