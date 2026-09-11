/** Extracts only durable non-reportable row resolutions for the review UI. */
export function resolvedNonReportableRowIds(payload: unknown): Set<string> {
  if (!payload || typeof payload !== 'object') return new Set();
  const resolutions = (payload as { resolutions?: unknown }).resolutions;
  if (!Array.isArray(resolutions)) return new Set();
  return new Set(
    resolutions.flatMap((resolution) => {
      if (!resolution || typeof resolution !== 'object') return [];
      const value = resolution as { sourceRowId?: unknown; resolutionKind?: unknown };
      return typeof value.sourceRowId === 'string' && value.sourceRowId.trim() && value.resolutionKind === 'non_reportable'
        ? [value.sourceRowId]
        : [];
    }),
  );
}
