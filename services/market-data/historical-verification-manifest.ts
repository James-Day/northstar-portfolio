import type { IsoDate } from '@/lib/domain/types';
import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import type { HistoricalVerificationCategory, HistoricalVerificationCase } from './historical-verification';

export type HistoricalEvidenceStatus = 'pending' | 'verified';

export type HistoricalVerificationEvidence = {
  status: HistoricalEvidenceStatus;
  sourceName: string;
  sourceUrl: string;
  retrievedOn: IsoDate;
  locator: string;
  reviewer: string;
};

export type HistoricalVerificationManifestCase = {
  symbol: string;
  tradingDate: IsoDate;
  expectedClose: DecimalString | null;
  category: HistoricalVerificationCategory;
  evidence: HistoricalVerificationEvidence;
};

export type HistoricalVerificationManifestResult = {
  ready: boolean;
  verifiedCases: HistoricalVerificationCase[];
  pending: HistoricalVerificationManifestCase[];
  errors: string[];
};

/**
 * Validates operator-maintained independent evidence before it can be used as
 * an acceptance fixture. Pending rows remain visible and are never silently
 * treated as verified. This does not fetch or attest to any external source.
 */
export function validateHistoricalVerificationManifest(
  manifest: HistoricalVerificationManifestCase[],
): HistoricalVerificationManifestResult {
  const errors: string[] = [];
  const pending: HistoricalVerificationManifestCase[] = [];
  const verifiedCases: HistoricalVerificationCase[] = [];
  const seen = new Set<string>();

  manifest.forEach((fixture, index) => {
    const prefix = `case[${index}]`;
    if (!fixture.symbol.trim()) errors.push(`${prefix}.symbol is required.`);
    try { isoDate(fixture.tradingDate); } catch { errors.push(`${prefix}.tradingDate must be a valid calendar date.`); }
    const key = `${fixture.symbol.trim().toUpperCase()}|${fixture.tradingDate}`;
    if (seen.has(key)) errors.push(`${prefix} duplicates an earlier symbol/date case.`);
    seen.add(key);
    if (!['pending', 'verified'].includes(fixture.evidence.status)) errors.push(`${prefix}.evidence.status must be pending or verified.`);
    if (fixture.evidence.status === 'verified') {
      if (!/^https:\/\//.test(fixture.evidence.sourceUrl)) errors.push(`${prefix}.evidence.sourceUrl must use HTTPS.`);
      if (!fixture.evidence.sourceName.trim()) errors.push(`${prefix}.evidence.sourceName is required.`);
      if (!fixture.evidence.locator.trim()) errors.push(`${prefix}.evidence.locator is required.`);
      if (!fixture.evidence.reviewer.trim()) errors.push(`${prefix}.evidence.reviewer is required.`);
    }
    if (fixture.evidence.status === 'verified' && fixture.expectedClose === null) {
      errors.push(`${prefix}.expectedClose is required for verified evidence.`);
    }
    if (fixture.evidence.status === 'verified' && fixture.expectedClose !== null) {
      try {
        const close = new Decimal(decimalString(fixture.expectedClose));
        if (!close.isFinite() || close.lte(0)) errors.push(`${prefix}.expectedClose must be a positive finite decimal.`);
      } catch { errors.push(`${prefix}.expectedClose must be a valid decimal.`); }
    }
    if (fixture.evidence.status === 'pending') {
      pending.push(fixture);
      return;
    }
    if (fixture.expectedClose !== null) {
      verifiedCases.push({
        symbol: fixture.symbol,
        tradingDate: fixture.tradingDate,
        expectedClose: fixture.expectedClose,
        category: fixture.category,
        evidence: `${fixture.evidence.sourceName} — ${fixture.evidence.locator} (reviewed by ${fixture.evidence.reviewer} on ${fixture.evidence.retrievedOn})`,
      });
    }
  });

  return { ready: errors.length === 0 && pending.length === 0, verifiedCases, pending, errors };
}
