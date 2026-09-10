import { describe, expect, it } from "vitest";
import { decimalString } from "@/lib/domain/money";
import { isoDate, type DailyClose } from "@/lib/domain/types";
import { valueLedgerHistory } from "@/services/calculations/valuation";

const d = decimalString;
import type { LedgerEvent } from "@/services/ledger/fifo";

const date = (value: string) => isoDate(value);
const close = (tradingDate: string, value: string): DailyClose => ({
  instrumentId: "instrument-1" as never,
  tradingDate: date(tradingDate),
  close: decimalString(value),
  source: "dolthub",
  sourceRevision: "fixture",
});

describe("valueLedgerHistory", () => {
  it("values actual open quantities plus cash and excludes deposits from investment gain", () => {
    const events: LedgerEvent[] = [
      {
        id: "deposit",
        date: date("2026-01-02"),
        type: "deposit",
        amount: decimalString("100"),
      },
      {
        id: "buy",
        date: date("2026-01-02"),
        type: "buy",
        instrumentId: "instrument-1",
        quantity: decimalString("1"),
        grossAmount: decimalString("100"),
        fee: decimalString("0"),
      },
    ];
    const history = valueLedgerHistory({
      dates: [
        { date: date("2026-01-02"), canChainFromPrevious: false },
        { date: date("2026-01-03"), canChainFromPrevious: true },
      ],
      events,
      closes: [close("2026-01-02", "100"), close("2026-01-03", "110")],
    });

    expect(history.valuations[0]).toMatchObject({
      cash: "0",
      totalValue: "100",
      externalFlows: "100",
    });
    expect(history.valuations[1]).toMatchObject({
      totalValue: "110",
      return: { investmentGain: "10", return: "0.1" },
    });
    expect(history.timeWeightedReturn).toBe("0.1");
  });

  it("does not double count DRIP income and makes a missing close unavailable", () => {
    const events: LedgerEvent[] = [
      {
        id: "deposit",
        date: date("2026-01-02"),
        type: "deposit",
        amount: decimalString("100"),
      },
      {
        id: "buy",
        date: date("2026-01-02"),
        type: "buy",
        instrumentId: "instrument-1",
        quantity: decimalString("1"),
        grossAmount: decimalString("100"),
        fee: decimalString("0"),
      },
      {
        id: "dividend",
        date: date("2026-01-03"),
        type: "dividend",
        amount: decimalString("5"),
      },
      {
        id: "drip",
        date: date("2026-01-03"),
        type: "drip_buy",
        instrumentId: "instrument-1",
        quantity: decimalString("0.05"),
        grossAmount: decimalString("5"),
        fee: decimalString("0"),
      },
    ];
    const history = valueLedgerHistory({
      dates: [
        { date: date("2026-01-02"), canChainFromPrevious: false },
        { date: date("2026-01-03"), canChainFromPrevious: true },
        { date: date("2026-01-04"), canChainFromPrevious: true },
      ],
      events,
      closes: [close("2026-01-02", "100"), close("2026-01-03", "100")],
    });

    expect(history.valuations[1]).toMatchObject({
      cash: "0",
      totalValue: "105",
      holdings: [{ quantity: "1.05", value: "105" }],
      return: { investmentGain: "5" },
    });
    expect(history.valuations[2]).toMatchObject({
      totalValue: null,
      missingInstrumentIds: ["instrument-1"],
      return: { unavailableReason: "missing_valuation" },
    });
    expect(history.timeWeightedReturn).toBeNull();
  });

  it("does not chain a complete return across a caller-marked valuation gap", () => {
    const history = valueLedgerHistory({
      dates: [
        { date: date("2026-01-01"), canChainFromPrevious: false },
        { date: date("2026-01-02"), canChainFromPrevious: false },
      ],
      events: [
        {
          id: "deposit",
          date: date("2026-01-01"),
          type: "deposit",
          amount: decimalString("100"),
        },
      ],
      closes: [],
    });

    expect(history.valuations[1].return).toMatchObject({
      investmentGain: "0",
      return: "0",
    });
    expect(history.timeWeightedReturn).toBeNull();
  });

  it("does not call a deposit or IRA incentive investment profit", () => {
    const history = valueLedgerHistory({
      dates: [
        { date: date("2026-01-01"), canChainFromPrevious: false },
        { date: date("2026-01-02"), canChainFromPrevious: true },
      ],
      events: [
        {
          id: "initial",
          date: date("2026-01-01"),
          type: "deposit",
          amount: decimalString("100"),
        },
        {
          id: "contribution",
          date: date("2026-01-02"),
          type: "deposit",
          amount: decimalString("50"),
        },
        {
          id: "incentive",
          date: date("2026-01-02"),
          type: "ira_incentive",
          amount: decimalString("10"),
        },
      ],
      closes: [],
    });

    expect(history.valuations[1]).toMatchObject({
      totalValue: "160",
      externalFlows: "50",
      excludedIncentives: "10",
      return: { investmentGain: "0", return: "0" },
    });
  });

  it("applies only validated splits at their effective valuation date", () => {
    const history = valueLedgerHistory({
      dates: [
        { date: date("2026-01-02"), canChainFromPrevious: false },
        { date: date("2026-01-03"), canChainFromPrevious: true },
      ],
      events: [
        {
          id: "deposit",
          date: date("2026-01-02"),
          type: "deposit",
          amount: decimalString("100"),
        },
        {
          id: "buy",
          date: date("2026-01-02"),
          type: "buy",
          instrumentId: "instrument-1",
          quantity: decimalString("1"),
          grossAmount: decimalString("100"),
          fee: decimalString("0"),
        },
      ],
      closes: [close("2026-01-02", "100"), close("2026-01-03", "50")],
      corporateActions: [
        {
          instrumentId: "instrument-1",
          type: "split",
          status: "validated",
          ratioNumerator: decimalString("2"),
          ratioDenominator: decimalString("1"),
          effectiveDate: date("2026-01-03"),
        },
      ],
    });
    expect(history.valuations[0].holdings).toMatchObject([
      { quantity: "1", value: "100" },
    ]);
    expect(history.valuations[1].holdings).toMatchObject([
      { quantity: "2", value: "100" },
    ]);
  });

  it("applies a split before later trades on the same historical replay", () => {
    const history = valueLedgerHistory({
      dates: [{ date: date("2026-01-05"), canChainFromPrevious: true }],
      events: [
        {
          id: "buy-before",
          date: date("2026-01-01"),
          type: "buy",
          instrumentId: "instrument-1" as never,
          quantity: d("1"),
          grossAmount: d("100"),
          fee: d("0"),
        },
        {
          id: "buy-after",
          date: date("2026-01-04"),
          type: "buy",
          instrumentId: "instrument-1" as never,
          quantity: d("1"),
          grossAmount: d("60"),
          fee: d("0"),
        },
      ],
      closes: [
        {
          instrumentId: "instrument-1" as never,
          tradingDate: date("2026-01-05"),
          close: d("40"),
          source: "manual_correction",
          sourceRevision: "fixture",
        },
      ],
      corporateActions: [
        {
          instrumentId: "instrument-1",
          type: "split",
          status: "validated",
          ratioNumerator: d("2"),
          ratioDenominator: d("1"),
          effectiveDate: date("2026-01-03"),
        },
      ],
    });

    expect(history.valuations[0].holdings).toMatchObject([
      { quantity: "3", value: "120" },
    ]);
  });
});
