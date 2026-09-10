import type { IsoDate } from '@/lib/domain/types';

export type PriceFreshness = { symbol: string; expectedDate: IsoDate; latestDate: IsoDate | null; status: 'current' | 'stale' | 'missing' };

/** Classifies freshness without treating a missing close as zero. */
export function classifyPriceFreshness(input: { symbols: string[]; expectedDate: IsoDate; latestBySymbol: Record<string, IsoDate | null> }): PriceFreshness[] {
  return [...new Set(input.symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].sort().map((symbol) => {
    const latestDate = input.latestBySymbol[symbol] ?? null;
    return { symbol, expectedDate: input.expectedDate, latestDate, status: latestDate === null ? 'missing' : latestDate < input.expectedDate ? 'stale' : 'current' };
  });
}
