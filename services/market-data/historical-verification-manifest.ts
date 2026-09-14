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

function isSafeHttpsEvidenceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Validates operator-maintained independent evidence before it can be used as
 * an acceptance fixture. Pending rows remain visible and are never silently
 * treated as verified. This does not fetch or attest to any external source.
 */
export function validateHistoricalVerificationManifest(
  manifest: unknown,
): HistoricalVerificationManifestResult {
  const errors: string[] = [];
  const pending: HistoricalVerificationManifestCase[] = [];
  const verifiedCases: HistoricalVerificationCase[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(manifest)) return { ready: false, verifiedCases, pending, errors: ['Verification manifest cases must be an array.'] };

  manifest.forEach((fixture, index) => {
    const prefix = `case[${index}]`;
    if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }
    const row = fixture as Partial<HistoricalVerificationManifestCase>;
    if (typeof row.symbol !== 'string' || !row.symbol.trim()) errors.push(`${prefix}.symbol is required.`);
    if (typeof row.tradingDate !== 'string') errors.push(`${prefix}.tradingDate must be a valid calendar date.`);
    else try { isoDate(row.tradingDate); } catch { errors.push(`${prefix}.tradingDate must be a valid calendar date.`); }
    if (!row.evidence || typeof row.evidence !== 'object' || Array.isArray(row.evidence)) {
      errors.push(`${prefix}.evidence must be an object.`);
      return;
    }
    const evidence = row.evidence as Partial<HistoricalVerificationEvidence>;
    const symbol = typeof row.symbol === 'string' ? row.symbol : '';
    const tradingDate = typeof row.tradingDate === 'string' ? row.tradingDate : '';
    const key = `${symbol.trim().toUpperCase()}|${tradingDate}`;
    if (seen.has(key)) errors.push(`${prefix} duplicates an earlier symbol/date case.`);
    seen.add(key);
    if (!['pending', 'verified'].includes(evidence.status ?? '')) errors.push(`${prefix}.evidence.status must be pending or verified.`);
    if (evidence.status === 'verified') {
      if (!isSafeHttpsEvidenceUrl(evidence.sourceUrl)) errors.push(`${prefix}.evidence.sourceUrl must be a credential-free HTTPS URL.`);
      if (typeof evidence.sourceName !== 'string' || !evidence.sourceName.trim()) errors.push(`${prefix}.evidence.sourceName is required.`);
      if (typeof evidence.locator !== 'string' || !evidence.locator.trim()) errors.push(`${prefix}.evidence.locator is required.`);
      if (typeof evidence.reviewer !== 'string' || !evidence.reviewer.trim()) errors.push(`${prefix}.evidence.reviewer is required.`);
    }
    if (evidence.status === 'verified' && row.expectedClose === null) {
      errors.push(`${prefix}.expectedClose is required for verified evidence.`);
    }
    if (evidence.status === 'verified' && row.expectedClose !== null) {
      try {
        const close = new Decimal(decimalString(row.expectedClose as DecimalString));
        if (!close.isFinite() || close.lte(0)) errors.push(`${prefix}.expectedClose must be a positive finite decimal.`);
      } catch { errors.push(`${prefix}.expectedClose must be a valid decimal.`); }
    }
    if (evidence.status === 'pending') {
      pending.push(row as HistoricalVerificationManifestCase);
      return;
    }
    if (row.expectedClose !== null && typeof row.expectedClose === 'string') {
      verifiedCases.push({
        symbol,
        tradingDate: tradingDate as IsoDate,
        expectedClose: row.expectedClose as DecimalString,
        category: row.category as HistoricalVerificationCategory,
        evidence: `${evidence.sourceName} — ${evidence.locator} (reviewed by ${evidence.reviewer} on ${evidence.retrievedOn})`,
      });
    }
  });

  return { ready: errors.length === 0 && pending.length === 0, verifiedCases, pending, errors };
}
