import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { DailyClose, InstrumentId, IsoDate } from '@/lib/domain/types';

export type PriceCorrection = {
  instrumentId: InstrumentId;
  tradingDate: IsoDate;
  correctedClose: DecimalString;
  evidence: string;
  correctionVersion: string;
};

export function createPriceCorrection(input: Omit<PriceCorrection, 'correctedClose'> & { correctedClose: string | number }): PriceCorrection {
  const evidence = input.evidence.trim();
  const correctionVersion = input.correctionVersion.trim();
  const correctedClose = decimalString(input.correctedClose);
  if (!input.instrumentId.trim()) throw new Error('Price corrections require an instrument ID.');
  if (!evidence) throw new Error('Price corrections require evidence.');
  if (!correctionVersion) throw new Error('Price corrections require a correction version.');
  if (correctedClose === '0') throw new Error('Corrected close must be greater than zero.');
  return { ...input, correctedClose, evidence, correctionVersion };
}

/** Applies an explicit correction while retaining the original source close for audit. */
export function resolveAuthoritativeClose(original: DailyClose, corrections: PriceCorrection[]): { original: DailyClose; authoritative: DailyClose } {
  const matching = corrections.filter((correction) => correction.instrumentId === original.instrumentId && correction.tradingDate === original.tradingDate);
  if (!matching.length) return { original, authoritative: original };
  const correction = [...matching].sort((left, right) => left.correctionVersion.localeCompare(right.correctionVersion)).at(-1)!;
  return { original, authoritative: { ...original, close: correction.correctedClose, source: 'manual_correction', sourceRevision: correction.correctionVersion } };
}
