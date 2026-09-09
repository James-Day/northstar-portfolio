export type ImportStatus = 'staged' | 'processing' | 'ready_for_review' | 'committed' | 'discarded' | 'undone' | 'failed';

export type ImportReview = {
  status: ImportStatus;
  sourceRowCount: number;
  acceptedRowCount: number;
  unsupportedRowCount: number;
  invalidRowCount: number;
  duplicateRowCount: number;
  materialUnsupportedRowCount: number;
};

const allowedTransitions: Record<ImportStatus, ImportStatus[]> = {
  staged: ['processing', 'discarded'],
  processing: ['ready_for_review', 'failed', 'discarded'],
  ready_for_review: ['committed', 'discarded'],
  committed: ['undone'],
  discarded: [],
  undone: [],
  failed: ['processing', 'discarded'],
};

export function transitionImport(current: ImportStatus, next: ImportStatus): ImportStatus {
  if (!allowedTransitions[current].includes(next)) throw new Error(`Cannot transition import from ${current} to ${next}.`);
  return next;
}

/** Material unsupported activity must be resolved before committing a reportable import. */
export function assertImportCanCommit(review: ImportReview) {
  if (review.status !== 'ready_for_review') throw new Error('Only an import ready for review can be committed.');
  if (review.acceptedRowCount === 0) throw new Error('An import needs at least one accepted activity before it can be committed.');
  if (review.invalidRowCount > 0) throw new Error('Resolve invalid source rows before committing this import.');
  if (review.materialUnsupportedRowCount > 0) throw new Error('Resolve material unsupported activity before committing this import.');
}

export function buildImportReview(rows: Array<{ status: 'supported' | 'unsupported' | 'invalid' | 'duplicate'; materiallyAffectsReports?: boolean }>): ImportReview {
  const count = (status: 'supported' | 'unsupported' | 'invalid' | 'duplicate') => rows.filter((row) => row.status === status).length;
  return {
    status: 'ready_for_review',
    sourceRowCount: rows.length,
    acceptedRowCount: count('supported'),
    unsupportedRowCount: count('unsupported'),
    invalidRowCount: count('invalid'),
    duplicateRowCount: count('duplicate'),
    materialUnsupportedRowCount: rows.filter((row) => row.status === 'unsupported' && row.materiallyAffectsReports).length,
  };
}
