export type PrivateWorkspaceResetters = {
  setEmail: (value: unknown) => void;
  setUserId: (value: unknown) => void;
  setAccounts: (value: unknown) => void;
  setSelectedAccountId: (value: unknown) => void;
  setOpeningHistory: (value: unknown) => void;
  setLivePreview: (value: unknown) => void;
  setLiveRows: (value: unknown) => void;
  setStagedCsv: (value: unknown) => void;
  setStagedImportId: (value: unknown) => void;
  setImportHistory: (value: unknown) => void;
  setFreshnessReport: (value: unknown) => void;
  setReportSnapshot: (value: unknown) => void;
  setActivityPage: (value: unknown) => void;
  setBillingStatus: (value: unknown) => void;
};

/** Clears every user-owned value held by the dashboard when identity changes. */
export function clearPrivateWorkspaceState(resetters: PrivateWorkspaceResetters): void {
  resetters.setEmail(undefined);
  resetters.setUserId(undefined);
  resetters.setAccounts([]);
  resetters.setSelectedAccountId(undefined);
  resetters.setOpeningHistory(undefined);
  resetters.setLivePreview(undefined);
  resetters.setStagedCsv(undefined);
  resetters.setStagedImportId(undefined);
  resetters.setLiveRows([]);
  resetters.setImportHistory([]);
  resetters.setFreshnessReport(undefined);
  resetters.setReportSnapshot(undefined);
  resetters.setActivityPage(undefined);
  resetters.setBillingStatus(undefined);
}
