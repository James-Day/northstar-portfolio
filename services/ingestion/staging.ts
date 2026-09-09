import { assertImportCanCommit, buildImportReview, type ImportReview } from '@/services/ingestion/workflow';
import {
  parseRobinhoodActivityCsv,
  ROBINHOOD_ACTIVITY_PARSER_VERSION,
  type ParsedRobinhoodRow,
} from '@/services/ingestion/robinhood';
import type { IsoDate } from '@/lib/domain/types';

export type StagedRobinhoodImport = {
  accountId: string;
  fileSha256: string;
  parserVersion: typeof ROBINHOOD_ACTIVITY_PARSER_VERSION;
  rows: ParsedRobinhoodRow[];
  review: ImportReview;
  activityFrom: IsoDate | null;
  activityThrough: IsoDate | null;
  duplicateFile: boolean;
};

/**
 * Creates the immutable data needed to stage a Robinhood statement. The hash
 * covers the original bytes, while overlap fingerprinting later protects
 * against exports that contain the same activity with different file bytes.
 */
export async function stageRobinhoodImport(accountId: string, csv: string, existingFileHashes: Iterable<string> = []): Promise<StagedRobinhoodImport> {
  if (!accountId.trim()) throw new Error('A confirmed account is required before importing activity.');
  const rows = parseRobinhoodActivityCsv(csv);
  const review = buildImportReview(rows.map((row) => ({
    status: row.status,
    materiallyAffectsReports: row.status === 'unsupported' ? true : undefined,
  })));
  const dates = rows.flatMap((row) => row.status === 'supported' && row.activity ? [row.activity.effectiveDate] : []);
  const fileSha256 = await sha256Hex(csv);
  return {
    accountId,
    fileSha256,
    parserVersion: ROBINHOOD_ACTIVITY_PARSER_VERSION,
    rows,
    review,
    activityFrom: dates.length ? dates.reduce((earliest, date) => date < earliest ? date : earliest) : null,
    activityThrough: dates.length ? dates.reduce((latest, date) => date > latest ? date : latest) : null,
    duplicateFile: [...existingFileHashes].some((existingHash) => existingHash.trim().toLowerCase() === fileSha256),
  };
}

export function assertStagedImportCanCommit(staged: StagedRobinhoodImport) {
  if (staged.duplicateFile) throw new Error('This exact statement was already imported for the selected account.');
  assertImportCanCommit(staged.review);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
