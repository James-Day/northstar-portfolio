import { describe, expect, it } from "vitest";
import {
  assertStagedImportCanCommit,
  sha256Hex,
  stageRobinhoodImport,
  toPersistableImportStage,
} from "@/services/ingestion/staging";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Robinhood import staging", () => {
  const csv =
    "Activity Date,Trans Code,Instrument,Quantity,Price,Amount\n2026-01-04,Buy,VTI,1,$100,$100\n2026-01-02,Cash Dividend,VTI,,,$2\n2026-01-03,Unknown Event,,,,$3";

  it.each([
    "individual-activity.csv",
    "traditional-ira-activity.csv",
    "roth-ira-activity.csv",
  ])(
    "stages sanitized Robinhood fixture %s with supported activity",
    async (fileName) => {
      const fixture = readFileSync(
        resolve("fixtures/robinhood", fileName),
        "utf8",
      );
      const staged = await stageRobinhoodImport("account-fixture", fixture);
      expect(staged.rows.length).toBeGreaterThan(0);
      expect(staged.review.invalidRowCount).toBe(0);
      expect(staged.review.acceptedRowCount).toBeGreaterThan(0);
      expect(() => assertStagedImportCanCommit(staged)).not.toThrow();
    },
  );

  it("records an immutable original-file SHA-256, parser version, review status, and activity range", async () => {
    await expect(
      stageRobinhoodImport("account-123", csv),
    ).resolves.toMatchObject({
      accountId: "account-123",
      parserVersion: "robinhood-activity-v2",
      activityFrom: "2026-01-02",
      activityThrough: "2026-01-04",
      review: {
        sourceRowCount: 3,
        acceptedRowCount: 2,
        unsupportedRowCount: 1,
        materialUnsupportedRowCount: 1,
      },
    });
  });

  it("is deterministic for identical bytes and differentiates changed bytes", async () => {
    await expect(sha256Hex("Northstar")).resolves.toBe(
      "69929af9dd04b2e3537b0cc38d1180f2ff56691c93b3850c3b17a0c009880812",
    );
    expect(await sha256Hex("Northstar\n")).not.toBe(
      await sha256Hex("Northstar"),
    );
  });

  it("requires the user to choose a confirmed account before staging", async () => {
    await expect(stageRobinhoodImport(" ", csv)).rejects.toThrow(
      "confirmed account",
    );
  });

  it("detects an identical statement before a commit can double-count it", async () => {
    const staged = await stageRobinhoodImport("account-123", csv);
    const duplicate = await stageRobinhoodImport("account-123", csv, [
      staged.fileSha256.toUpperCase(),
    ]);
    expect(duplicate.duplicateFile).toBe(true);
    expect(() => assertStagedImportCanCommit(duplicate)).toThrow(
      "already imported",
    );
  });

  it("builds a storage-safe staging payload with review counts separate from raw rows", async () => {
    const staged = await stageRobinhoodImport("account-123", csv);
    expect(toPersistableImportStage(staged, "activity.csv")).toMatchObject({
      fileName: "activity.csv",
      usableRowCount: 2,
      warningCount: 1,
    });
    expect(() => toPersistableImportStage(staged, "../activity.csv")).toThrow(
      "without path characters",
    );
  });

  it("does not let a malformed earlier row make partial history look complete", async () => {
    const partial = [
      "Activity Date,Trans Code,Instrument,Quantity,Price,Amount",
      "2025-01-01,Buy,VTI,1,$100,not-money",
      "2026-01-04,Buy,VTI,1,$100,$100",
    ].join("\n");
    const staged = await stageRobinhoodImport("account-123", partial);
    expect(staged.review.invalidRowCount).toBe(1);
    expect(staged.activityFrom).toBe("2026-01-04");
    expect(staged.activityThrough).toBe("2026-01-04");
    expect(() => assertStagedImportCanCommit(staged)).toThrow("invalid source rows");
  });
});
