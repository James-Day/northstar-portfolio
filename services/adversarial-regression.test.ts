import { describe, expect, it, vi } from "vitest";
import { decimalString } from "@/lib/domain/money";
import { isoDate } from "@/lib/domain/types";
import { createApi } from "@/services/api/app";
import { verifySupabaseSession } from "@/services/auth/server-session";
import { ImportOperationRejectedError } from "@/services/supabase/imports-repository";
import { excludeOverlappingActivities, type FingerprintableActivity } from "@/services/ingestion/deduplication";
import { valueLedgerHistory } from "@/services/calculations/valuation";
import { prepareDailyPriceRefresh } from "@/services/market-data/daily-refresh";
import { applyBillingWebhook, type Entitlement } from "@/services/billing/entitlements";
import { consumeQueueMessages } from "@/services/queues/consumer";
import { createReportRecomputeHandler, recomputeReport, type ReportRecomputeContext } from "@/services/reporting/report-queue-handler";
import type { PersistedReportInputs } from "@/services/reporting/compose-report-inputs";

const date = (value: string) => isoDate(value);
const close = (instrumentId: string, tradingDate: string, value: string) => ({
  instrumentId: instrumentId as never,
  tradingDate: date(tradingDate),
  close: decimalString(value),
  source: "dolthub" as const,
  sourceRevision: "fixture",
});

describe("adversarial regression coverage", () => {
  it("does not let a valid session read an account absent from the caller's RLS view", async () => {
    const activity = vi.fn();
    const app = createApi({
      verifySession: async () => ({ id: "user-a", accessToken: "session-a" }),
      accountsRepository: {
        list: async () => [],
        get: async (userId) => userId === "user-a" ? undefined : ({ id: "account-b" } as never),
        create: async () => { throw new Error("unused"); },
      },
      activityRepository: { list: activity },
    });

    const response = await app.request("http://api.test/v1/accounts/account-b/activity", {
      headers: { authorization: "Bearer session-a" },
    });

    expect(response.status).toBe(404);
    expect(activity).not.toHaveBeenCalled();
  });

  it("does not disclose another user's import by guessed ID", async () => {
    const get = vi.fn().mockResolvedValue(undefined);
    const app = createApi({
      verifySession: async () => ({ id: "user-a", accessToken: "session-a" }),
      importsRepository: {
        get,
        hasFileHash: async () => false,
        stage: async () => ({ id: "unused", status: "ready_for_review" as const }),
        list: async () => [],
        discard: async () => undefined,
        commit: async () => undefined,
        undo: async () => undefined,
      },
    });

    const response = await app.request("http://api.test/v1/imports/import-owned-by-user-b", {
      headers: { authorization: "Bearer session-a" },
    });

    expect(response.status).toBe(404);
    expect(get).toHaveBeenCalledWith("import-owned-by-user-b", "session-a");
  });

  it("rejects an expired session before any private work is attempted", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const user = await verifySupabaseSession(
      new Request("https://api.test/v1/me", { headers: { authorization: "Bearer expired-token" } }),
      { supabaseUrl: "https://project.supabase.co", supabaseAnonKey: "public-key" },
      fetcher,
    );

    expect(user).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an expired session at the API boundary before reading private activity", async () => {
    const activity = vi.fn();
    const app = createApi({
      verifySession: async () => undefined,
      activityRepository: { list: activity },
    });

    const response = await app.request("http://api.test/v1/accounts/account-a/activity", {
      headers: { authorization: "Bearer expired-token" },
    });

    expect(response.status).toBe(401);
    expect(activity).not.toHaveBeenCalled();
  });

  it("serializes overlapping commit and undo attempts into one valid transition", async () => {
    let status: "ready_for_review" | "committed" | "undone" = "ready_for_review";
    let tail = Promise.resolve();
    const serialize = async <T>(operation: () => T): Promise<T> => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return operation(); } finally { release(); }
    };
    const summary = {
      id: "import-a", accountId: "account-a", status: "committed" as const,
      fileName: "activity.csv", sourceRowCount: 1, usableRowCount: 1,
      warningCount: 0, activityFrom: "2026-01-02", activityThrough: "2026-01-02",
      createdAt: "2026-01-03T00:00:00.000Z", committedAt: "2026-01-03T00:00:00.000Z",
    };
    const imports = {
      get: async () => undefined,
      hasFileHash: async () => false,
      stage: async () => ({ id: "unused", status: "ready_for_review" as const }),
      list: async () => [],
      discard: async () => undefined,
      commit: async () => serialize(() => {
        if (status !== "ready_for_review") throw new ImportOperationRejectedError();
        status = "committed";
        return summary;
      }),
      undo: async () => serialize(() => {
        if (status !== "committed") throw new ImportOperationRejectedError();
        status = "undone";
        return { ...summary, status: "undone" as const };
      }),
    };
    const app = createApi({
      verifySession: async () => ({ id: "user-a", accessToken: "session-a" }),
      importsRepository: imports,
    });

    const [commit, undo] = await Promise.all([
      app.request("http://api.test/v1/imports/import-a/commit", { method: "POST", headers: { authorization: "Bearer session-a" } }),
      app.request("http://api.test/v1/imports/import-a/undo", { method: "POST", headers: { authorization: "Bearer session-a" } }),
    ]);

    // Depending on which request acquires the account lock first, undo either
    // follows the commit successfully or is rejected while the import is
    // still review-ready. Both outcomes are safe; neither may produce a
    // server error or duplicate a ledger transition.
    expect([commit.status, undo.status].every((value) => value === 200 || value === 409)).toBe(true);
    expect([commit.status, undo.status]).toContain(200);
    expect(status).toMatch(/committed|undone/);
  });

  it("deduplicates one repeated DRIP while preserving a second legitimate reinvestment", () => {
    const drip: FingerprintableActivity = {
      accountId: "account-1", effectiveDate: date("2026-01-05"), type: "drip_buy",
      symbol: "VTI", quantity: decimalString("0.01"), price: decimalString("200"),
      amount: decimalString("-2"), description: "Reinvested dividend",
    };
    const result = excludeOverlappingActivities([drip], [drip, drip]);

    expect(result.duplicates).toHaveLength(1);
    expect(result.accepted).toHaveLength(1);
  });

  it("makes a valuation unavailable when any held instrument lacks a close", () => {
    const history = valueLedgerHistory({
      dates: [{ date: date("2026-01-05"), canChainFromPrevious: false }],
      events: [
        { id: "buy-a", date: date("2026-01-02"), type: "buy", instrumentId: "instrument-a" as never, quantity: decimalString("1"), grossAmount: decimalString("10"), fee: decimalString("0") },
        { id: "buy-b", date: date("2026-01-02"), type: "buy", instrumentId: "instrument-b" as never, quantity: decimalString("1"), grossAmount: decimalString("20"), fee: decimalString("0") },
      ],
      closes: [close("instrument-a", "2026-01-05", "11")],
    });

    expect(history.valuations[0]).toMatchObject({ totalValue: null, missingInstrumentIds: ["instrument-b"] });
    expect(history.valuations[0].return).toMatchObject({ unavailableReason: "missing_valuation" });
  });

  it("replays a report job safely when the queue delivers the same message twice", async () => {
    const inputs: PersistedReportInputs = {
      valuation: { dates: [{ date: date("2026-01-05"), canChainFromPrevious: false }], events: [], openingLots: [], closes: [], corporateActions: [] },
      ledger: { cash: decimalString("0"), openLots: [], realizedGainLoss: decimalString("0"), dividendIncome: decimalString("0"), netDeposits: decimalString("0"), sales: [] },
      activityCoveredThrough: date("2026-01-04"), pricesThrough: date("2026-01-05"), importStateRevision: "ledger:1",
    };
    const context: ReportRecomputeContext = { userId: "user-1", accountId: "account-1", inputs, priceRevisionId: "price:1" };
    const publish = vi.fn().mockResolvedValue("snapshot-1");
    const deps = { load: vi.fn().mockResolvedValue(context), isCurrent: vi.fn().mockResolvedValue(true), publisher: { publish } };
    const job = { kind: "report.recompute" as const, accountId: "account-1", requestedBy: "user-1", reason: "import_committed" as const };
    const message = { body: job, ack: vi.fn(), retry: vi.fn() };
    const handler = createReportRecomputeHandler(deps);

    await consumeQueueMessages([message], { reportRecompute: handler });
    await consumeQueueMessages([message], { reportRecompute: handler });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0][0]).toEqual(publish.mock.calls[1][0]);
  });

  it("allows only one concurrent refresh to reserve the remaining quota", async () => {
    let used = 99;
    const reserve = vi.fn(async ({ units }: { units: number }) => {
      if (used + units > 100) throw new Error("Market-data monthly quota exhausted.");
      used += units;
      return { reservationId: `r-${used}`, units };
    });
    const ledger = { reserve, reconcile: vi.fn().mockResolvedValue({ reservationId: "r", reservedUnits: 1, consumedUnits: 1, releasedUnits: 0 }) };
    const provider = { getDailyPrices: vi.fn().mockResolvedValue([{ symbol: "AAPL", tradingDate: date("2026-07-06"), close: decimalString("100"), provider: "marketstack" as const, providerMetadata: {} }]) };
    const now = new Date("2026-07-06T22:00:00.000Z");
    const results = await Promise.all([
      prepareDailyPriceRefresh(now, ["AAPL"], provider, { monthlyCap: 100, ledger }),
      prepareDailyPriceRefresh(now, ["AAPL"], provider, { monthlyCap: 100, ledger }),
    ]);

    expect(results.filter((result) => result.status === "ready_to_persist")).toHaveLength(1);
    expect(results.filter((result) => result.status === "skipped" && result.reason === "quota_exhausted")).toHaveLength(1);
    expect(provider.getDailyPrices).toHaveBeenCalledTimes(1);
  });

  it("applies webhook ordering so delayed cancellation cannot override a newer active event", () => {
    const inactive: Entitlement = { status: "inactive", trialStartedAt: null, trialEndsAt: null, processedWebhookIds: [], lastWebhookCreatedAt: null, lastWebhookId: null };
    const active = applyBillingWebhook(inactive, { id: "evt-active", type: "subscription_active", createdAt: new Date("2026-02-03T00:00:00Z") });
    const final = applyBillingWebhook(active, { id: "evt-canceled-old", type: "subscription_canceled", createdAt: new Date("2026-02-02T00:00:00Z") });

    expect(final.status).toBe("active");
    expect(final.processedWebhookIds).toEqual(["evt-active", "evt-canceled-old"]);
  });
});
