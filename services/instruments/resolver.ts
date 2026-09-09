import type { InstrumentAlias, InstrumentId, IsoDate } from '@/lib/domain/types';

/** Resolves a ticker only when exactly one effective internal alias matches. */
export function resolveInstrumentAlias(aliases: InstrumentAlias[], symbol: string, effectiveDate: IsoDate): InstrumentId | undefined {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const matches = aliases.filter((alias) => alias.symbol === normalizedSymbol && alias.effectiveFrom <= effectiveDate && (alias.effectiveTo === null || alias.effectiveTo >= effectiveDate));
  if (matches.length > 1) throw new Error(`Ticker ${normalizedSymbol} has ambiguous aliases on ${effectiveDate}.`);
  return matches[0]?.instrumentId;
}
