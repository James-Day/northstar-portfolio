import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { DailyClose, InstrumentId, IsoDate } from '@/lib/domain/types';

export type PriceCorrection = {
  instrumentId: InstrumentId;
  tradingDate: IsoDate;
  correctedClose: DecimalString;
  evidence: string;
  correctionVersion: string;
};

export type PriceDependency = {
  instrumentId: InstrumentId;
  tradingDate: IsoDate;
  source: DailyClose['source'];
  sourceRevision: string;
  correctionVersion: string | null;
};

export type AuthoritativePriceSelection = {
  closes: DailyClose[];
  dependencies: PriceDependency[];
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
  const selection = selectAuthoritativePrices([original], corrections);
  return { original, authoritative: selection.closes[0] ?? original };
}

/**
 * Selects one reproducible close for each instrument/date. A source revision is
 * immutable: two different values reported under the same revision are an
 * ambiguity and fail closed. Evidence-backed corrections take precedence over
 * provider prices; provider precedence is explicit so historical and daily
 * sources cannot win by incidental array order.
 */
export function selectAuthoritativePrices(closes: DailyClose[], corrections: PriceCorrection[] = []): AuthoritativePriceSelection {
  const byKey = new Map<string, DailyClose[]>();
  for (const close of closes) {
    const key = `${close.instrumentId}|${close.tradingDate}`;
    const values = byKey.get(key) ?? [];
    values.push(close);
    byKey.set(key, values);
  }

  const selected: DailyClose[] = [];
  const dependencies: PriceDependency[] = [];
  for (const [key, candidates] of [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [instrumentId, tradingDate] = key.split('|') as [InstrumentId, IsoDate];
    const sourceCandidates = [...new Map(candidates.map((candidate) => [`${candidate.source}|${candidate.sourceRevision}`, candidate])).values()];
    for (const candidate of candidates) {
      const sameVersion = candidates.filter((item) => item.source === candidate.source && item.sourceRevision === candidate.sourceRevision);
      if (sameVersion.some((item) => item.close !== candidate.close)) {
        throw new Error(`Ambiguous ${candidate.source} price revision ${candidate.sourceRevision} for ${instrumentId} on ${tradingDate}.`);
      }
    }
    const matchingCorrections = corrections.filter((correction) => correction.instrumentId === instrumentId && correction.tradingDate === tradingDate);
    const correction = chooseCorrection(matchingCorrections, instrumentId, tradingDate);
    const provider = [...sourceCandidates].sort((left, right) => sourceRank(right.source) - sourceRank(left.source) || right.sourceRevision.localeCompare(left.sourceRevision))[0];
    if (!provider && !correction) continue;
    const authoritative = correction
      ? { ...(provider ?? { instrumentId, tradingDate, close: correction.correctedClose, source: 'manual_correction' as const, sourceRevision: correction.correctionVersion }), close: correction.correctedClose, source: 'manual_correction' as const, sourceRevision: correction.correctionVersion }
      : provider;
    selected.push(authoritative);
    dependencies.push({ instrumentId, tradingDate, source: provider?.source ?? 'manual_correction', sourceRevision: provider?.sourceRevision ?? correction!.correctionVersion, correctionVersion: correction?.correctionVersion ?? null });
  }
  return { closes: selected, dependencies };
}

function chooseCorrection(corrections: PriceCorrection[], instrumentId: InstrumentId, tradingDate: IsoDate) {
  for (const correction of corrections) {
    const sameVersion = corrections.filter((item) => item.correctionVersion === correction.correctionVersion);
    if (sameVersion.some((item) => item.correctedClose !== correction.correctedClose || item.evidence !== correction.evidence)) {
      throw new Error(`Ambiguous manual correction version ${correction.correctionVersion} for ${instrumentId} on ${tradingDate}.`);
    }
  }
  return [...corrections].sort((left, right) => right.correctionVersion.localeCompare(left.correctionVersion))[0];
}

function sourceRank(source: DailyClose['source']) {
  return source === 'marketstack' ? 2 : source === 'dolthub' ? 1 : 0;
}
