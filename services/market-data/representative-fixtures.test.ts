import { describe, expect, it } from "vitest";
import { decimalString } from "@/lib/domain/money";
import { isoDate, type InstrumentAlias } from "@/lib/domain/types";
import {
  prepareHistoricalPriceIngestion,
  inspectHistoricalContinuity,
} from "@/services/market-data/historical-ingestion";
import type { DoltHubDailyClose } from "@/services/market-data/dolthub";
const alias = (
  instrumentId: string,
  symbol: string,
  from: string,
  to: string | null = null,
): InstrumentAlias => ({
  instrumentId: instrumentId as InstrumentAlias["instrumentId"],
  symbol,
  effectiveFrom: isoDate(from),
  effectiveTo: to ? isoDate(to) : null,
});
const close = (
  symbol: string,
  date: string,
  value: string,
): DoltHubDailyClose => ({
  symbol,
  tradingDate: isoDate(date),
  close: decimalString(value),
  source: "dolthub",
  sourceRevision: "fixture-revision",
});
describe("representative historical price fixtures", () => {
  it("maps large-cap and ETF closes while preserving source symbols", () => {
    const result = prepareHistoricalPriceIngestion(
      [
        close("AAPL", "2024-01-02", "185.64"),
        close("SPY", "2024-01-02", "472.65"),
      ],
      [alias("apple", "AAPL", "2020-01-01"), alias("spy", "SPY", "1993-01-01")],
      "dolt-main-2024",
    );
    expect(result.quarantined).toEqual([]);
    expect(result.accepted).toEqual([
      expect.objectContaining({
        instrumentId: "apple",
        sourceSymbol: "AAPL",
        close: "185.64",
      }),
      expect.objectContaining({
        instrumentId: "spy",
        sourceSymbol: "SPY",
        close: "472.65",
      }),
    ]);
  });
  it("resolves ticker changes by effective date and quarantines delisted symbols without aliases", () => {
    const aliases = [
      alias("meta", "FB", "2012-01-01", "2022-06-08"),
      alias("meta", "META", "2022-06-09"),
      alias("old-security", "OLD", "2010-01-01", "2020-12-31"),
    ];
    const result = prepareHistoricalPriceIngestion(
      [
        close("FB", "2022-06-08", "189.56"),
        close("META", "2022-06-09", "184.00"),
        close("OLD", "2021-01-04", "12.00"),
      ],
      aliases,
      "dolt-main-2024",
    );
    expect(result.accepted.map((row) => row.instrumentId)).toEqual([
      "meta",
      "meta",
    ]);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].reason).toContain(
      "No effective instrument alias",
    );
  });
  it("quarantines suspicious split-like jumps and reports missing trading dates", () => {
    const records = [
      close("AAPL", "2024-01-02", "190.00"),
      close("AAPL", "2024-01-03", "10.00"),
      close("AAPL", "2024-01-05", "9.00"),
    ];
    const result = prepareHistoricalPriceIngestion(
      records,
      [alias("apple", "AAPL", "2020-01-01")],
      "dolt-main-2024",
    );
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].reason).toContain("Close changed");
    expect(result.continuityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: "AAPL",
          kind: "missing_trading_dates",
          dates: ["2024-01-04"],
        }),
      ]),
    );
  });
  it("flags ambiguous alias windows instead of guessing an instrument", () => {
    const result = inspectHistoricalContinuity(
      [close("ETF", "2024-01-02", "100.00")],
      [
        alias("fund-a", "ETF", "2020-01-01"),
        alias("fund-b", "ETF", "2020-01-01"),
      ],
    );
    expect(result).toEqual([
      { symbol: "ETF", kind: "alias_gap", dates: ["2024-01-02"] },
    ]);
  });
});
