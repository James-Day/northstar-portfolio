export const importIssueCodes = [
  "unsupported_row",
  "missing_instrument_alias",
  "incomplete_history",
] as const;
export type ImportIssueCode = (typeof importIssueCodes)[number];
export const importResolutionKinds = [
  "non_reportable",
  "alias_confirmed",
  "history_acknowledged",
] as const;
export type ImportResolutionKind = (typeof importResolutionKinds)[number];

export type ImportIssueResolution = {
  id: string;
  importId: string;
  sourceRowId: string | null;
  issueCode: ImportIssueCode;
  resolutionKind: ImportResolutionKind;
  note: string;
  resolvedBy: string;
  resolvedAt: string;
};

export function parseIssueResolution(
  input: unknown,
): Pick<
  ImportIssueResolution,
  "sourceRowId" | "issueCode" | "resolutionKind" | "note"
> {
  if (!input || typeof input !== "object")
    throw new Error("An issue resolution object is required.");
  const value = input as Record<string, unknown>;
  const sourceRowId =
    value.sourceRowId === null || value.sourceRowId === undefined
      ? null
      : value.sourceRowId;
  if (
    sourceRowId !== null &&
    (typeof sourceRowId !== "string" || !sourceRowId.trim())
  )
    throw new Error("sourceRowId must be a non-empty string or null.");
  if (!importIssueCodes.includes(value.issueCode as ImportIssueCode))
    throw new Error("Unsupported import issue code.");
  if (
    !importResolutionKinds.includes(
      value.resolutionKind as ImportResolutionKind,
    )
  )
    throw new Error("Unsupported import resolution kind.");
  if (
    typeof value.note !== "string" ||
    value.note.trim().length < 3 ||
    value.note.length > 1000
  )
    throw new Error(
      "A resolution note between 3 and 1000 characters is required.",
    );
  const issueCode = value.issueCode as ImportIssueCode;
  const resolutionKind = value.resolutionKind as ImportResolutionKind;
  const validPair =
    (issueCode === "unsupported_row" && resolutionKind === "non_reportable") ||
    (issueCode === "missing_instrument_alias" &&
      resolutionKind === "alias_confirmed") ||
    (issueCode === "incomplete_history" &&
      resolutionKind === "history_acknowledged");
  if (!validPair)
    throw new Error("The resolution kind does not match the issue code.");
  return { sourceRowId, issueCode, resolutionKind, note: value.note.trim() };
}

export function unresolvedMaterialIssueCount(
  rows: Array<{ status: string; id?: string }>,
  resolutions: ImportIssueResolution[],
): number {
  return rows.filter(
    (row) =>
      (row.status === "unsupported" || row.status === "invalid") &&
      !resolutions.some(
        (resolution) =>
          resolution.sourceRowId === row.id &&
          resolution.issueCode === "unsupported_row" &&
          resolution.resolutionKind === "non_reportable",
      ),
  ).length;
}
