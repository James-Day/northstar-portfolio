export type RawFileRecord = {
  importId: string;
  objectPath: string;
  uploadedAt: Date;
  deletedAt: Date | null;
};

const RETENTION_DAYS = 30;

/** Selects raw brokerage files that are eligible for irreversible object deletion. */
export function rawFilesEligibleForDeletion(files: RawFileRecord[], now: Date): RawFileRecord[] {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  return files.filter((file) => file.deletedAt === null && file.uploadedAt.getTime() <= cutoff.getTime());
}

export function markRawFileDeleted(file: RawFileRecord, deletedAt: Date): RawFileRecord {
  if (file.deletedAt) throw new Error(`Raw file for import ${file.importId} was already deleted.`);
  return { ...file, deletedAt };
}
