import { describe, expect, it } from "vitest";
import {
  classifyRefreshAlerts,
  evaluateQuota,
  RefreshMetricsCollector,
} from "@/services/market-data/refresh-metrics";

describe("daily refresh metrics", () => {
  it("aggregates refresh events without losing retry attempts", () => {
    const metrics = new RefreshMetricsCollector();
    metrics.record({
      type: "attempt",
      attempt: 1,
      maxAttempts: 3,
      symbolCount: 4,
    });
    metrics.record({
      type: "failed",
      attempt: 1,
      maxAttempts: 3,
      message: "temporary",
    });
    metrics.record({
      type: "attempt",
      attempt: 2,
      maxAttempts: 3,
      symbolCount: 4,
    });
    metrics.record({ type: "requested", symbolCount: 4 });
    metrics.record({
      type: "persisted",
      tradingDate: "2026-07-06" as never,
      symbolCount: 4,
      upserted: 4,
    });
    expect(metrics.getSnapshot()).toEqual({
      attempts: 2,
      failedAttempts: 1,
      skippedRuns: 0,
      requestedSymbols: 4,
      persistedRows: 4,
      publicationPendingSymbols: 0,
    });
  });

  it("does not charge skipped attempts as provider usage", () => {
    const metrics = new RefreshMetricsCollector();
    metrics.record({
      type: "attempt",
      attempt: 1,
      maxAttempts: 3,
      symbolCount: 100,
    });
    metrics.record({ type: "skipped", reason: "already_fetched" });
    expect(metrics.getSnapshot()).toMatchObject({
      attempts: 1,
      skippedRuns: 1,
      requestedSymbols: 0,
      publicationPendingSymbols: 0,
    });
  });

  it("counts symbols waiting for delayed publication", () => {
    const metrics = new RefreshMetricsCollector();
    metrics.record({ type: "skipped", reason: "provider_data_pending", symbolCount: 3 });
    expect(metrics.getSnapshot().publicationPendingSymbols).toBe(3);
  });

  it("alerts when the configured reserve would be consumed", () => {
    expect(evaluateQuota(8_100, 10_000)).toEqual({
      usedUnits: 8_100,
      monthlyCap: 10_000,
      reserveUnits: 2_000,
      remainingUnits: 1_900,
      alert: true,
    });
    expect(evaluateQuota(7_500, 10_000).alert).toBe(false);
  });
});

describe("refresh operational alerts", () => {
  it("surfaces provider, quota, partial, and stale outcomes explicitly", () => {
    expect(
      classifyRefreshAlerts({
        status: "failed",
        failedAttempts: 3,
        requestedSymbols: 5,
        persistedRows: 0,
        quotaExhausted: true,
        staleSymbols: 2,
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "provider_failure",
        severity: "critical",
      }),
      expect.objectContaining({ kind: "quota_exhausted" }),
      expect.objectContaining({ kind: "stale_prices", severity: "warning" }),
    ]);
    expect(
      classifyRefreshAlerts({
        status: "persisted",
        failedAttempts: 0,
        requestedSymbols: 5,
        persistedRows: 3,
      }),
    ).toEqual([expect.objectContaining({ kind: "partial_persistence" })]);
  });

  it("distinguishes delayed publication from a provider outage", () => {
    expect(classifyRefreshAlerts({ status: "skipped", failedAttempts: 0, requestedSymbols: 2, persistedRows: 0, publicationPendingSymbols: 2 })).toEqual([
      expect.objectContaining({ kind: "publication_pending", severity: "warning" }),
    ]);
  });
});
