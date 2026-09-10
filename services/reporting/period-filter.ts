export type ReportPeriod = "1m" | "3m" | "ytd" | "1y" | "all";

export type ReportHistoryPoint = { date: string; value: string | null };

export const reportPeriodOptions: Array<{ value: ReportPeriod; label: string }> = [
  { value: "1m", label: "1 month" },
  { value: "3m", label: "3 months" },
  { value: "ytd", label: "Year to date" },
  { value: "1y", label: "1 year" },
  { value: "all", label: "All time" },
];

/** Filters stored valuation points without manufacturing values for missing dates. */
export function filterReportHistory(points: ReportHistoryPoint[], period: ReportPeriod): ReportHistoryPoint[] {
  if (period === "all" || points.length === 0) return points;

  const latestDate = points.reduce((latest, point) => point.date > latest ? point.date : latest, points[0].date);
  const latest = new Date(`${latestDate}T00:00:00.000Z`);
  if (Number.isNaN(latest.getTime())) return points;

  const start = new Date(latest);
  if (period === "1m") start.setUTCMonth(start.getUTCMonth() - 1);
  if (period === "3m") start.setUTCMonth(start.getUTCMonth() - 3);
  if (period === "1y") start.setUTCFullYear(start.getUTCFullYear() - 1);
  if (period === "ytd") start.setUTCMonth(0, 1);
  const startDate = start.toISOString().slice(0, 10);
  return points.filter((point) => point.date >= startDate && point.date <= latestDate);
}

export function reportPeriodDescription(period: ReportPeriod): string {
  return reportPeriodOptions.find((option) => option.value === period)?.label ?? "All time";
}
