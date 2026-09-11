import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

describe("issue resolution migration contract", () => {
  it("makes account-scoped acknowledgements unique and requires opening-history disclosure", async () => {
    const sql = (await readFile(`${migrationsDirectory}/20260913130000_harden_issue_resolution_scope.sql`, "utf8")).toLowerCase();
    expect(sql).toMatch(/create unique index[\s\S]*import_issue_resolutions_account_issue_unique[\s\S]*where source_row_id is null/);
    expect(sql).toMatch(/account_opening_history/);
    expect(sql).toMatch(/incomplete-history acknowledgement requires an explicit opening-history explanation/);
    expect(sql).toMatch(/revoke all on function public\.validate_import_issue_resolution\(\)/);
  });
});
