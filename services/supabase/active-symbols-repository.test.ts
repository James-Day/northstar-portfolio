import { describe, expect, it, vi } from "vitest";
import { SupabaseActiveSymbolsRepository } from "@/services/supabase/active-symbols-repository";

describe("Supabase active-symbol repository", () => {
  it("coalesces open lots across users and resolves current aliases", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { instrument_id: "11111111-1111-4111-8111-111111111111" },
            { instrument_id: "11111111-1111-4111-8111-111111111111" },
            { instrument_id: "22222222-2222-4222-8222-222222222222" },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              instrument_id: "22222222-2222-4222-8222-222222222222",
              symbol: "vti",
            },
            {
              instrument_id: "11111111-1111-4111-8111-111111111111",
              symbol: "AAPL",
            },
          ]),
        ),
      );
    const repository = new SupabaseActiveSymbolsRepository({
      supabaseUrl: "https://supabase.test",
      serviceRoleKey: "service-secret",
      fetcher: fetcher as typeof fetch,
    });
    await expect(repository.list()).resolves.toEqual(["AAPL", "VTI"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls[0][0].searchParams.get("remaining_quantity"),
    ).toBe("gt.0");
    expect(fetcher.mock.calls[1][0].searchParams.get("effective_to")).toBe(
      "is.null",
    );
  });

  it("avoids the alias query when no open lots exist", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]"));
    const repository = new SupabaseActiveSymbolsRepository({
      supabaseUrl: "https://supabase.test",
      serviceRoleKey: "service-secret",
      fetcher: fetcher as typeof fetch,
    });
    await expect(repository.list()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("paginates open lots before resolving aliases", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { instrument_id: "11111111-1111-4111-8111-111111111111" },
            { instrument_id: "22222222-2222-4222-8222-222222222222" },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { instrument_id: "33333333-3333-4333-8333-333333333333" },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              instrument_id: "11111111-1111-4111-8111-111111111111",
              symbol: "AAPL",
            },
            {
              instrument_id: "22222222-2222-4222-8222-222222222222",
              symbol: "MSFT",
            },
            {
              instrument_id: "33333333-3333-4333-8333-333333333333",
              symbol: "VTI",
            },
          ]),
        ),
      );
    const repository = new SupabaseActiveSymbolsRepository({
      supabaseUrl: "https://supabase.test",
      serviceRoleKey: "service-secret",
      fetcher: fetcher as typeof fetch,
      pageSize: 2,
    });
    await expect(repository.list()).resolves.toEqual(["AAPL", "MSFT", "VTI"]);
    expect(fetcher.mock.calls[0][0].searchParams.get("offset")).toBe("0");
    expect(fetcher.mock.calls[1][0].searchParams.get("offset")).toBe("2");
  });

  it('reports active instruments whose current alias is missing', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ instrument_id: "11111111-1111-4111-8111-111111111111" }, { instrument_id: "22222222-2222-4222-8222-222222222222" }]))).mockResolvedValueOnce(new Response(JSON.stringify([{ instrument_id: "11111111-1111-4111-8111-111111111111", symbol: "AAPL" }])));
    const repository = new SupabaseActiveSymbolsRepository({ supabaseUrl: "https://supabase.test", serviceRoleKey: "secret", fetcher: fetcher as typeof fetch });
    await expect(repository.listDetailed()).resolves.toEqual({ symbols: ['AAPL'], unresolvedInstrumentIds: ['22222222-2222-4222-8222-222222222222'] });
  });
});
