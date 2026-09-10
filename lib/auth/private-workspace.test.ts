import { describe, expect, it, vi } from 'vitest';
import { clearPrivateWorkspaceState } from '@/lib/auth/private-workspace';

describe('private workspace cache', () => {
  it('clears identity, account, import and report state together', () => {
    const names = ['email', 'userId', 'accounts', 'selectedAccountId', 'openingHistory', 'livePreview', 'stagedCsv', 'stagedImportId', 'liveRows', 'importHistory', 'freshnessReport', 'reportSnapshot', 'activityPage', 'billingStatus'] as const;
    const calls = Object.fromEntries(names.map((name) => [name, vi.fn<(value: unknown) => void>()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn<(value: unknown) => void>>>;
    clearPrivateWorkspaceState({
      setEmail: calls.email, setUserId: calls.userId, setAccounts: calls.accounts, setSelectedAccountId: calls.selectedAccountId,
      setOpeningHistory: calls.openingHistory, setLivePreview: calls.livePreview, setStagedCsv: calls.stagedCsv, setStagedImportId: calls.stagedImportId,
      setLiveRows: calls.liveRows, setImportHistory: calls.importHistory, setFreshnessReport: calls.freshnessReport, setReportSnapshot: calls.reportSnapshot,
      setActivityPage: calls.activityPage, setBillingStatus: calls.billingStatus,
    });
    expect(calls.email).toHaveBeenCalledWith(undefined);
    expect(calls.accounts).toHaveBeenCalledWith([]);
    expect(calls.liveRows).toHaveBeenCalledWith([]);
    expect(calls.billingStatus).toHaveBeenCalledWith(undefined);
    expect(Object.values(calls).every((call) => call.mock.calls.length === 1)).toBe(true);
  });
});
