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
});
