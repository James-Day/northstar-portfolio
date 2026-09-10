# Operating-cost budget

The MVP has a fixed operating-cost guardrail of **$45–$75 per month before marketing**. A projected total above **$100 per month** is an escalation that requires a deliberate plan or pricing decision; the application must not upgrade a provider automatically.

The typed check lives in `services/platform/operating-costs.ts`. It sums integer-cent line items, the selected provider plan, and a conservatively rounded overage allowance. It returns `within_target`, `review`, or `escalate`. Keep estimates separate from invoices and attach a source URL and verification date to every reviewed line item.

## Current Marketstack planning input

The official [Marketstack pricing page](https://marketstack.com/pricing) was checked on **2026-09-10**:

| Plan | Monthly price | Included requests | Commercial use |
| --- | ---: | ---: | --- |
| Free | $0 | 100 | No |
| Basic | $9.99 | 10,000 | Yes |
| Professional | $49.99 | 100,000 | Yes |
| Business | $149.99 | 500,000 | Yes |

The free plan is development-only for this product because the page identifies it as non-commercial. Basic is the first plan modeled for a paid launch. A 20% reserve for retries and failures leaves `floor(included requests × 0.8 ÷ 22)` symbols per daily refresh: **3** on Free, **363** on Basic. This is a capacity planning estimate, not a promise of API availability.

The provider's displayed Basic overage rate is fractional cents per request. The budget module accepts whole cents and therefore rounds any configured overage estimate upward. This deliberately protects the monthly budget; use the provider invoice as the source of truth when validating the launch gate.

## Review procedure

1. Record current invoices or published prices in the line-item list, with a URL and date.
2. Select the actual Marketstack plan and set the monthly request cap to the verified allowance.
3. Include expected overage at a conservative whole-cent rate, if overage is enabled.
4. Run `assessOperatingCosts` and store the result with the launch evidence.
5. Escalate any `escalate` result before marketing or paid-user launch. Never change plans or enable overage as a side effect of a scheduled job.
