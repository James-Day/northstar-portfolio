import { describe, expect, it } from "vitest";
import {
  parseIssueResolution,
  unresolvedMaterialIssueCount,
} from "@/services/ingestion/issue-resolution";

describe("import issue resolution", () => {
  it("accepts only the resolution kind matching the issue", () => {
    expect(
      parseIssueResolution({
        sourceRowId: "row-1",
        issueCode: "unsupported_row",
        resolutionKind: "non_reportable",
        note: "Excluded by user review",
      }),
    ).toMatchObject({
      issueCode: "unsupported_row",
      resolutionKind: "non_reportable",
    });
    expect(() =>
      parseIssueResolution({
        sourceRowId: "row-1",
        issueCode: "unsupported_row",
        resolutionKind: "alias_confirmed",
        note: "wrong kind",
      }),
    ).toThrow("does not match");
  });

  it("requires an auditable note and counts unresolved material rows", () => {
    expect(() =>
      parseIssueResolution({
        sourceRowId: null,
        issueCode: "incomplete_history",
        resolutionKind: "history_acknowledged",
        note: "x",
      }),
    ).toThrow("between 3 and 1000");
    expect(
      unresolvedMaterialIssueCount(
        [
          { id: "a", status: "unsupported" },
          { id: "b", status: "invalid" },
        ],
        [
          {
            id: "r",
            importId: "i",
            sourceRowId: "a",
            issueCode: "unsupported_row",
            resolutionKind: "non_reportable",
            note: "Excluded",
            resolvedBy: "u",
            resolvedAt: "now",
          },
        ],
      ),
    ).toBe(1);
  });

  it("does not let a mismatched resolution kind or issue code clear a blocker", () => {
    const resolution = {
      id: "r",
      importId: "i",
      sourceRowId: "a",
      issueCode: "missing_instrument_alias" as const,
      resolutionKind: "non_reportable" as const,
      note: "Incorrectly paired",
      resolvedBy: "u",
      resolvedAt: "now",
    };
    expect(unresolvedMaterialIssueCount([{ id: "a", status: "unsupported" }], [resolution])).toBe(1);
    expect(unresolvedMaterialIssueCount([{ id: "a", status: "invalid" }], [resolution])).toBe(1);
  });

  it("keeps alias and incomplete-history blockers until their specific acknowledgements exist", () => {
    const resolutions = [{
      id: "alias-resolution",
      importId: "i",
      sourceRowId: "alias-row",
      issueCode: "missing_instrument_alias" as const,
      resolutionKind: "alias_confirmed" as const,
      note: "Confirmed against the statement symbol",
      resolvedBy: "u",
      resolvedAt: "now",
    }];
    expect(unresolvedMaterialIssueCount([
      { id: "alias-row", status: "supported", issueCode: "missing_instrument_alias" },
      { id: "history-row", status: "supported", issueCode: "incomplete_history" },
    ], resolutions)).toBe(1);
    expect(unresolvedMaterialIssueCount([
      { id: "alias-row", status: "supported", issueCode: "missing_instrument_alias" },
    ], resolutions)).toBe(0);
  });
});
