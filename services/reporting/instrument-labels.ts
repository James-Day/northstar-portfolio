export type InstrumentLabel = { instrumentId: string; displayName: string };

export function labelForInstrument(instrumentId: string, labels: InstrumentLabel[]): string {
  const match = labels.find((label) => label.instrumentId === instrumentId && label.displayName.trim());
  return match?.displayName.trim() || instrumentId;
}

export function mapInstrumentLabels(instrumentIds: string[], labels: InstrumentLabel[]): Record<string, string> {
  return Object.fromEntries([...new Set(instrumentIds)].map((id) => [id, labelForInstrument(id, labels)]));
}
