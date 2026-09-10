import {
  parseIssueResolution,
  type ImportIssueResolution,
  type ImportIssueCode,
  type ImportResolutionKind,
} from "@/services/ingestion/issue-resolution";

export type ImportIssueRepository = {
  list(importId: string, accessToken: string): Promise<ImportIssueResolution[]>;
  save(
    importId: string,
    accessToken: string,
    input: unknown,
  ): Promise<ImportIssueResolution>;
};

export class SupabaseImportIssueRepository implements ImportIssueRepository {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  constructor(
    private readonly options: {
      supabaseUrl: string;
      supabaseAnonKey: string;
      fetcher?: typeof fetch;
    },
  ) {
    this.baseUrl = new URL(options.supabaseUrl);
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }
  async list(importId: string, accessToken: string) {
    const url = new URL("/rest/v1/import_issue_resolutions", this.baseUrl);
    url.searchParams.set("import_id", `eq.${importId}`);
    url.searchParams.set(
      "select",
      "id,import_id,source_row_id,issue_code,resolution_kind,note,resolved_by,resolved_at",
    );
    url.searchParams.set("order", "resolved_at.asc");
    const response = await this.fetcher(url, {
      headers: this.headers(accessToken),
    });
    if (!response.ok)
      throw new Error(
        `Supabase import issue query failed with HTTP ${response.status}.`,
      );
    const rows: unknown = await response.json();
    if (!Array.isArray(rows))
      throw new Error(
        "Supabase import issue query returned an invalid result.",
      );
    return rows.map(toResolution);
  }
  async save(importId: string, accessToken: string, input: unknown) {
    const value = parseIssueResolution(input);
    const url = new URL("/rest/v1/import_issue_resolutions", this.baseUrl);
    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        ...this.headers(accessToken),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        import_id: importId,
        source_row_id: value.sourceRowId,
        issue_code: value.issueCode,
        resolution_kind: value.resolutionKind,
        note: value.note,
      }),
    });
    if (!response.ok)
      throw new Error(
        `Supabase import issue resolution failed with HTTP ${response.status}.`,
      );
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || !rows[0])
      throw new Error("Supabase import issue resolution returned no record.");
    return toResolution(rows[0]);
  }
  private headers(accessToken: string) {
    return {
      apikey: this.options.supabaseAnonKey,
      authorization: `Bearer ${accessToken}`,
    };
  }
}

function toResolution(row: unknown): ImportIssueResolution {
  if (!row || typeof row !== "object")
    throw new Error("Supabase returned an invalid issue resolution.");
  const value = row as Record<string, unknown>;
  const codes = [
    "unsupported_row",
    "missing_instrument_alias",
    "incomplete_history",
  ] as const;
  const kinds = [
    "non_reportable",
    "alias_confirmed",
    "history_acknowledged",
  ] as const;
  if (
    typeof value.id !== "string" ||
    typeof value.import_id !== "string" ||
    (value.source_row_id !== null && typeof value.source_row_id !== "string") ||
    !codes.includes(value.issue_code as ImportIssueCode) ||
    !kinds.includes(value.resolution_kind as ImportResolutionKind) ||
    typeof value.note !== "string" ||
    typeof value.resolved_by !== "string" ||
    typeof value.resolved_at !== "string"
  )
    throw new Error("Supabase returned an invalid issue resolution.");
  return {
    id: value.id,
    importId: value.import_id,
    sourceRowId: value.source_row_id,
    issueCode: value.issue_code as ImportIssueCode,
    resolutionKind: value.resolution_kind as ImportResolutionKind,
    note: value.note,
    resolvedBy: value.resolved_by,
    resolvedAt: value.resolved_at,
  };
}
