export type ReportDetailHolding = {
  instrumentId: string;
  displayName?: string;
  value: string | null;
};

export type AllocationRow = {
  key: string;
  label: string;
  value: number;
  percentage: number;
  unavailable: boolean;
};

/** Builds display-only allocation rows from persisted report values. */
export function buildAllocationRows(
  holdings: ReportDetailHolding[],
  cash: string | null,
  totalValue: string | null,
): AllocationRow[] {
  if (totalValue === null) return [];
  const total = Number(totalValue);
  if (!Number.isFinite(total) || total <= 0) return [];
  const rows = holdings.map((holding) => {
    const value = holding.value === null ? NaN : Number(holding.value);
    return {
      key: holding.instrumentId,
      label: holding.displayName ?? holding.instrumentId,
      value,
      percentage: Number.isFinite(value) ? (value / total) * 100 : 0,
      unavailable: !Number.isFinite(value),
    };
  });
  if (cash !== null) {
    const value = Number(cash);
    rows.push({
      key: 'cash',
      label: 'Cash',
      value,
      percentage: Number.isFinite(value) ? (value / total) * 100 : 0,
      unavailable: !Number.isFinite(value),
    });
  }
  return rows
    .filter((row) => row.unavailable || row.value > 0)
    .sort((left, right) => right.value - left.value);
}
