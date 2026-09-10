import { describe, expect, it, vi } from "vitest";
import { isoDate } from "@/lib/domain/types";
import {
  MarketstackProvider,
  MonthlyRequestBudget,
} from "@/services/market-data/marketstack";

describe("MarketstackProvider", () => {
  it("uses one server request per unique symbol and returns normalized close data", async () => {
    const fetcher = vi.fn(async (request: RequestInfo | URL) => {
      const url = new URL(String(request));
      const symbol = url.searchParams.get("symbols")!;
      return new Response(
        JSON.stringify({
          data: [
            {
              symbol,
              date: "2026-09-08T00:00:00+0000",
              close: 123.45,
              exchange: "XNAS",
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const budget = new MonthlyRequestBudget(3);
    const provider = new MarketstackProvider({
      apiKey: "development-key",
      fetcher,
      requestBudget: budget,
    });

    await expect(
      provider.getDailyPrices(["aapl", "AAPL", "MSFT"], isoDate("2026-09-08")),
    ).resolves.toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        close: "123.45",
        provider: "marketstack",
      }),
      expect.objectContaining({
        symbol: "MSFT",
        close: "123.45",
        provider: "marketstack",
      }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(budget.usedUnits).toBe(2);
  });

  it("stops before a request when the configured free-plan cap is exhausted", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const provider = new MarketstackProvider({
      apiKey: "development-key",
      fetcher,
      requestBudget: new MonthlyRequestBudget(1),
    });
    await expect(
      provider.getDailyPrices(["AAPL", "MSFT"], isoDate("2026-09-08")),
    ).rejects.toThrow("cap reached");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("supports bounded provider batches while reserving quota per symbol", async () => {
    const fetcher = vi.fn(async (request: RequestInfo | URL) => {
      const url = new URL(String(request));
      const symbols = url.searchParams.get("symbols")!.split(",");
      return new Response(
        JSON.stringify({
          data: symbols.map((symbol) => ({
            symbol,
            date: "2026-09-08T00:00:00+0000",
            close: 100,
          })),
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const budget = new MonthlyRequestBudget(3);
    const provider = new MarketstackProvider({
      apiKey: "development-key",
      fetcher,
      requestBudget: budget,
      maxSymbolsPerRequest: 2,
    });
    await expect(
      provider.getDailyPrices(["AAPL", "MSFT", "VTI"], isoDate("2026-09-08")),
    ).resolves.toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(budget.usedUnits).toBe(3);
  });
});
