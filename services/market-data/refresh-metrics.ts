import type {
  DailyRefreshEvent,
  DailyRefreshTelemetry,
} from "@/services/market-data/daily-refresh";

export type DailyRefreshMetricsSnapshot = {
  attempts: number;
  failedAttempts: number;
  skippedRuns: number;
  requestedSymbols: number;
  persistedRows: number;
};

export type QuotaAlert = {
  usedUnits: number;
  monthlyCap: number;
  reserveUnits: number;
  remainingUnits: number;
  alert: boolean;
};
export type RefreshOperationalAlert = {
  kind:
    | "provider_failure"
    | "quota_exhausted"
    | "partial_persistence"
    | "stale_prices";
  severity: "warning" | "critical";
  message: string;
};

/** Converts durable refresh outcomes into operator-facing alerts. Missing or
 * partial closes remain visible; this helper never turns them into prices. */
export function classifyRefreshAlerts(input: {
  status: "persisted" | "skipped" | "failed";
  failedAttempts: number;
  requestedSymbols: number;
  persistedRows: number;
  quotaExhausted?: boolean;
  staleSymbols?: number;
}): RefreshOperationalAlert[] {
  const alerts: RefreshOperationalAlert[] = [];
  if (input.status === "failed" && input.failedAttempts > 0)
    alerts.push({
      kind: "provider_failure",
      severity: "critical",
      message:
        "Daily price refresh failed after retries; affected valuation dates remain unavailable.",
    });
  if (input.quotaExhausted)
    alerts.push({
      kind: "quota_exhausted",
      severity: "critical",
      message:
        "The monthly market-data quota is exhausted; no additional provider calls will be attempted.",
    });
  if (
    input.status === "persisted" &&
    input.requestedSymbols > input.persistedRows
  )
    alerts.push({
      kind: "partial_persistence",
      severity: "critical",
      message:
        "The refresh persisted fewer closes than requested; missing symbols remain unavailable.",
    });
  if ((input.staleSymbols ?? 0) > 0)
    alerts.push({
      kind: "stale_prices",
      severity: "warning",
      message: `${input.staleSymbols} symbol(s) still have stale stored prices.`,
    });
  return alerts;
}

/** Lightweight event sink that can later be backed by a durable metrics table. */
export class RefreshMetricsCollector implements DailyRefreshTelemetry {
  private snapshot: DailyRefreshMetricsSnapshot = {
    attempts: 0,
    failedAttempts: 0,
    skippedRuns: 0,
    requestedSymbols: 0,
    persistedRows: 0,
  };

  record(event: DailyRefreshEvent) {
    if (event.type === "attempt") {
      this.snapshot.attempts += 1;
    } else if (event.type === "requested") {
      // Only provider calls consume Marketstack quota. In particular, an
      // attempt that exits through a weekend, cache, empty-symbol, or quota
      // guard must not inflate durable usage.
      this.snapshot.requestedSymbols += event.symbolCount;
    } else if (event.type === "failed") this.snapshot.failedAttempts += 1;
    else if (event.type === "skipped") this.snapshot.skippedRuns += 1;
    else if (event.type === "persisted")
      this.snapshot.persistedRows += event.upserted;
  }

  getSnapshot(): DailyRefreshMetricsSnapshot {
    return { ...this.snapshot };
  }
}

export function evaluateQuota(
  usedUnits: number,
  monthlyCap: number,
  reserveFraction = 0.2,
): QuotaAlert {
  if (!Number.isInteger(usedUnits) || usedUnits < 0)
    throw new Error("Used quota units must be a non-negative integer.");
  if (!Number.isInteger(monthlyCap) || monthlyCap < 1)
    throw new Error("Monthly quota cap must be a positive integer.");
  if (
    !Number.isFinite(reserveFraction) ||
    reserveFraction < 0 ||
    reserveFraction >= 1
  )
    throw new Error(
      "Quota reserve fraction must be from 0 through less than 1.",
    );
  const reserveUnits = Math.ceil(monthlyCap * reserveFraction);
  return {
    usedUnits,
    monthlyCap,
    reserveUnits,
    remainingUnits: Math.max(0, monthlyCap - usedUnits),
    alert: usedUnits + reserveUnits >= monthlyCap,
  };
}
