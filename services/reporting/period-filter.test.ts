import { describe, expect, it } from "vitest";
import { filterReportHistory, reportPeriodDescription } from "./period-filter";

const history = [
  { date: "2025-01-01", value: "100" },
  { date: "2025-06-30", value: "110" },
  { date: "2025-12-31", value: "120" },
  { date: "2026-01-15", value: null },
  { date: "2026-02-15", value: "125" },
];

describe("report period filter", () => {
  it("filters from the latest stored date and preserves unavailable points", () => {
    expect(filterReportHistory(history, "1m")).toEqual([
      { date: "2026-01-15", value: null },
      { date: "2026-02-15", value: "125" },
    ]);
  });

  it("supports year to date and all history", () => {
    expect(filterReportHistory(history, "ytd").map((point) => point.date)).toEqual(["2026-01-15", "2026-02-15"]);
    expect(filterReportHistory(history, "all")).toEqual(history);
  });

  it("has a readable label for each supported period", () => {
    expect(reportPeriodDescription("3m")).toBe("3 months");
  });
});
