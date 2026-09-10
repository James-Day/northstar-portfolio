"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileUp,
  HandCoins,
  Landmark,
  Menu,
  Plus,
  PieChart,
  Upload,
  WalletCards,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Activity,
  calculateSummary,
  demoActivities,
  demoHoldings,
  demoPrices,
  parseRobinhoodCsv,
} from "@/lib/portfolio";
import { createPublicSupabaseClient } from "@/services/supabase/client";
import type {
  AccountActivity,
  ActivityPage,
} from "@/services/supabase/activity-repository";
import {
  filterReportHistory,
  reportPeriodDescription,
  reportPeriodOptions,
  type ReportPeriod,
} from "@/services/reporting/period-filter";
import { SettingsPanel } from "@/components/settings-panel";
import type { OpeningHistory } from "@/services/accounts/opening-history";
import { buildAllocationRows } from "@/lib/report-details";
import { clearPrivateWorkspaceState } from "@/lib/auth/private-workspace";
import {
  getDashboardWarnings,
  type DashboardWarning,
} from "@/lib/dashboard-warnings";

type PublicSupabaseConfig = { url: string; anonKey: string };
type PublicApiConfig = { baseUrl: string };

function SessionLoadingState() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7fb] px-6 text-[#13233a]">
      <section
        className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm"
        role="status"
        aria-live="polite"
      >
        <div
          className="mx-auto h-10 w-10 animate-pulse rounded-2xl bg-[#eaf2ff]"
          aria-hidden="true"
        />
        <h1 className="mt-5 text-xl font-bold">Loading your workspace</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Checking your secure session before showing portfolio data.
        </p>
      </section>
    </main>
  );
}
type LiveAccount = {
  id: string;
  name: string;
  account_type: "individual" | "traditional_ira" | "roth_ira";
  brokerage: "robinhood";
  created_at: string;
};
type LiveOpeningHistory = OpeningHistory;
type LiveImportPreview = {
  accountId: string;
  duplicateFile: boolean;
  review: {
    sourceRowCount: number;
    acceptedRowCount: number;
    unsupportedRowCount: number;
    invalidRowCount: number;
    duplicateRowCount: number;
    materialUnsupportedRowCount: number;
  };
};
type LiveImportRow = {
  id: string;
  rowNumber: number;
  status: "supported" | "unsupported" | "invalid" | "duplicate";
  message: string | null;
  normalizedPayload: Record<string, unknown> | null;
};
type LiveImportSummary = {
  id: string;
  status:
    | "ready_for_review"
    | "committed"
    | "discarded"
    | "undone"
    | "failed"
    | "staged"
    | "processing";
  fileName: string;
  sourceRowCount: number;
  warningCount: number;
  createdAt: string;
  committedAt?: string | null;
};
type LiveFreshnessReport = {
  expectedDate: string;
  rows: Array<{
    symbol: string;
    expectedDate: string;
    latestDate: string | null;
    status: "current" | "stale" | "missing";
  }>;
};
type LiveReportHolding = {
  instrumentId: string;
  displayName?: string;
  quantity: string;
  close: string | null;
  value: string | null;
};
type LiveRealizedSale = {
  eventId: string;
  date: string;
  instrumentId: string;
  quantity: string;
  proceeds: string;
  matchedCostBasis: string | null;
  gainLoss: string | null;
  basisKnown: boolean;
};
type LiveReportSnapshot = {
  asOfDate: string;
  payload: {
    totalValue: string | null;
    cash: string | null;
    timeWeightedReturn: string | null;
    netDeposits?: string | null;
    dividendIncome?: string | null;
    realizedGainLoss?: string | null;
    realizedSales?: LiveRealizedSale[];
    valueHistory?: Array<{ date: string; value: string | null }>;
    activityCoveredThrough: string | null;
    pricesThrough: string | null;
    holdings: LiveReportHolding[];
    methodology?: {
      disclosure?: string;
      annualized?: boolean;
      taxReporting?: boolean;
      externalFlowTiming?: string;
      gapHandling?: string;
    };
  };
};
type LiveActivityPage = ActivityPage;
type LiveBillingStatus = {
  status: "inactive" | "trialing" | "active" | "past_due" | "canceled";
  allowed: boolean;
  reason:
    | "active"
    | "trialing"
    | "trial_expired"
    | "past_due"
    | "canceled"
    | "inactive";
  trialEndsAt: string | null;
};

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const precise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});
const nav = [
  ["Overview", ChartNoAxesCombined],
  ["Accounts", WalletCards],
  ["Activity", Clock3],
  ["Documents", FileUp],
  ["Settings", Landmark],
] as const;

function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "gold";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-500/10 text-emerald-700",
    gold: "bg-amber-400/15 text-amber-800",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function PortfolioApp({
  supabaseConfig,
  apiConfig,
}: {
  supabaseConfig?: PublicSupabaseConfig;
  apiConfig?: PublicApiConfig;
}) {
  const [active, setActive] = useState("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [stagedActivities, setStagedActivities] = useState<Activity[] | null>(
    null,
  );
  const [stagedFileName, setStagedFileName] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const summary = useMemo(() => calculateSummary(demoActivities), []);
  const client = useMemo(
    () =>
      supabaseConfig ? createPublicSupabaseClient(supabaseConfig) : undefined,
    [supabaseConfig],
  );
  const [email, setEmail] = useState<string>();
  const [userId, setUserId] = useState<string>();
  const [authLoading, setAuthLoading] = useState(Boolean(supabaseConfig));
  const [accounts, setAccounts] = useState<LiveAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string>();
  const [accountsRequestVersion, setAccountsRequestVersion] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string>();
  const [openingHistory, setOpeningHistory] = useState<LiveOpeningHistory>();
  const [openingHistoryLoading, setOpeningHistoryLoading] = useState(false);
  const [livePreview, setLivePreview] = useState<LiveImportPreview>();
  const [stagedCsv, setStagedCsv] = useState<string>();
  const [isStagingImport, setIsStagingImport] = useState(false);
  const [stageMessage, setStageMessage] = useState<string>();
  const [stagedImportId, setStagedImportId] = useState<string>();
  const [liveRows, setLiveRows] = useState<LiveImportRow[]>([]);
  const [importHistory, setImportHistory] = useState<LiveImportSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [freshnessReport, setFreshnessReport] = useState<LiveFreshnessReport>();
  const [freshnessLoading, setFreshnessLoading] = useState(false);
  const [freshnessError, setFreshnessError] = useState<string>();
  const [freshnessRequestVersion, setFreshnessRequestVersion] = useState(0);
  const [reportSnapshot, setReportSnapshot] = useState<LiveReportSnapshot>();
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string>();
  const [reportRequestVersion, setReportRequestVersion] = useState(0);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("all");
  const [reportScope, setReportScope] = useState<"account" | "consolidated">(
    "account",
  );
  const [activityPage, setActivityPage] = useState<LiveActivityPage>();
  const [activityOffset, setActivityOffset] = useState(0);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string>();
  const [activityRequestVersion, setActivityRequestVersion] = useState(0);
  const [activityFilter, setActivityFilter] = useState("");
  const [billingStatus, setBillingStatus] = useState<LiveBillingStatus>();
  const authGeneration = useRef(0);

  function clearAccountWorkspaceState() {
    setOpeningHistory(undefined);
    setLivePreview(undefined);
    setStagedCsv(undefined);
    setStagedImportId(undefined);
    setLiveRows([]);
    setImportHistory([]);
    setFreshnessReport(undefined);
    setReportSnapshot(undefined);
    setActivityPage(undefined);
    setActivityOffset(0);
    setFreshnessError(undefined);
    setReportError(undefined);
    setActivityError(undefined);
  }

  function clearSessionWorkspaceState() {
    clearPrivateWorkspaceState({
      setEmail: () => setEmail(undefined),
      setUserId: () => setUserId(undefined),
      setAccounts: () => setAccounts([]),
      setSelectedAccountId: () => setSelectedAccountId(undefined),
      setOpeningHistory: () => setOpeningHistory(undefined),
      setLivePreview: () => setLivePreview(undefined),
      setStagedCsv: () => setStagedCsv(undefined),
      setStagedImportId: () => setStagedImportId(undefined),
      setLiveRows: () => setLiveRows([]),
      setImportHistory: () => setImportHistory([]),
      setFreshnessReport: () => setFreshnessReport(undefined),
      setReportSnapshot: () => setReportSnapshot(undefined),
      setActivityPage: () => setActivityPage(undefined),
      setBillingStatus: () => setBillingStatus(undefined),
    });
    setAccountsError(undefined);
    setFreshnessError(undefined);
    setReportError(undefined);
    setActivityError(undefined);
    setStageMessage(undefined);
    setActive("Overview");
    setMenuOpen(false);
    setReviewOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  useEffect(() => {
    if (!client) return;
    let active = true;
    const generation = authGeneration.current;
    void client.auth.getUser().then(({ data }) => {
      if (active && generation === authGeneration.current) {
        setEmail(data.user?.email);
        setUserId(data.user?.id);
        setAuthLoading(false);
      }
    });
    const { data: listener } = client.auth.onAuthStateChange(
      (_event, session) => {
        authGeneration.current += 1;
        const nextUserId = session?.user.id;
        if (!nextUserId || (userId && nextUserId !== userId))
          clearSessionWorkspaceState();
        setEmail(session?.user.email);
        setUserId(nextUserId);
        setAuthLoading(false);
      },
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client, userId]);

  // Account switching must never leave the previous account's report or import
  // rows visible while the new account requests are in flight.
  useEffect(() => {
    if (selectedAccountId) clearAccountWorkspaceState();
    // The fetch effects below repopulate account-scoped state after this reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  useEffect(() => {
    if (!client || !userId || !apiConfig) {
      setBillingStatus(undefined);
      return;
    }
    let active = true;
    void client.auth.getSession().then(async ({ data }) => {
      if (!data.session?.access_token) return;
      const response = await fetch(`${apiConfig.baseUrl}/v1/billing/status`, {
        headers: { authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => undefined)) as
        | {
            entitlement?: { status?: unknown; trialEndsAt?: unknown };
            access?: { allowed?: unknown; reason?: unknown };
          }
        | undefined;
      const status = payload?.entitlement?.status;
      const reason = payload?.access?.reason;
      const trialEndsAt = payload?.entitlement?.trialEndsAt;
      if (
        !active ||
        (status !== "inactive" &&
          status !== "trialing" &&
          status !== "active" &&
          status !== "past_due" &&
          status !== "canceled") ||
        (reason !== "active" &&
          reason !== "trialing" &&
          reason !== "trial_expired" &&
          reason !== "past_due" &&
          reason !== "canceled" &&
          reason !== "inactive")
      )
        return;
      setBillingStatus({
        status,
        allowed: payload?.access?.allowed === true,
        reason,
        trialEndsAt: typeof trialEndsAt === "string" ? trialEndsAt : null,
      });
    });
    return () => {
      active = false;
    };
  }, [apiConfig, client, userId]);

  useEffect(() => {
    if (!client || !userId) {
      setAccounts([]);
      return;
    }
    let active = true;
    setAccountsLoading(true);
    setAccountsError(undefined);
    void client
      .from("accounts")
      .select("id,name,account_type,brokerage,created_at")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!active) return;
        setAccountsLoading(false);
        if (error) {
          setAccountsError(error.message || "We could not load your accounts.");
          return;
        }
        setAccounts((data ?? []) as LiveAccount[]);
      });
    return () => {
      active = false;
    };
  }, [client, userId, accountsRequestVersion]);

  useEffect(() => {
    if (!selectedAccountId && accounts[0]) setSelectedAccountId(accounts[0].id);
    if (
      selectedAccountId &&
      !accounts.some((account) => account.id === selectedAccountId)
    )
      setSelectedAccountId(accounts[0]?.id);
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    if (!client || !apiConfig || !userId || !selectedAccountId) {
      setOpeningHistory(undefined);
      return;
    }
    let active = true;
    setOpeningHistoryLoading(true);
    void client.auth
      .getSession()
      .then(async ({ data }) => {
        if (!data.session?.access_token) return;
        const response = await fetch(
          `${apiConfig.baseUrl}/v1/accounts/${selectedAccountId}/opening-history`,
          { headers: { authorization: `Bearer ${data.session.access_token}` } },
        );
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Opening history is unavailable.");
        if (
          active &&
          payload &&
          typeof payload === "object" &&
          "history" in payload
        )
          setOpeningHistory(
            (payload as { history: LiveOpeningHistory | null }).history ??
              undefined,
          );
      })
      .catch(() => {
        if (active) setOpeningHistory(undefined);
      })
      .finally(() => {
        if (active) setOpeningHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiConfig, client, selectedAccountId, userId]);

  async function saveOpeningHistory(history: OpeningHistory) {
    if (!client || !apiConfig || !selectedAccountId)
      throw new Error("Select an account first.");
    const { data } = await client.auth.getSession();
    if (!data.session?.access_token)
      throw new Error("Your sign-in session has expired.");
    const response = await fetch(
      `${apiConfig.baseUrl}/v1/accounts/${selectedAccountId}/opening-history`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${data.session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(history),
      },
    );
    const payload: unknown = await response.json();
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object" ||
      !("history" in payload)
    )
      throw new Error(
        payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : "Opening history could not be saved.",
      );
    setOpeningHistory((payload as { history: LiveOpeningHistory }).history);
  }

  useEffect(() => {
    if (!client || !apiConfig || !userId || !selectedAccountId) {
      setImportHistory([]);
      return;
    }
    let active = true;
    setHistoryLoading(true);
    void client.auth
      .getSession()
      .then(async ({ data }) => {
        if (!data.session?.access_token) return;
        const response = await fetch(
          `${apiConfig.baseUrl}/v1/accounts/${selectedAccountId}/imports`,
          { headers: { authorization: `Bearer ${data.session.access_token}` } },
        );
        const payload: unknown = await response.json();
        if (
          active &&
          response.ok &&
          payload &&
          typeof payload === "object" &&
          "imports" in payload &&
          Array.isArray(payload.imports)
        )
          setImportHistory(payload.imports as LiveImportSummary[]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiConfig, client, historyVersion, selectedAccountId, userId]);

  useEffect(() => {
    if (!client || !apiConfig || !userId || !selectedAccountId) {
      setFreshnessReport(undefined);
      return;
    }
    let active = true;
    setFreshnessLoading(true);
    setFreshnessError(undefined);
    void client.auth
      .getSession()
      .then(async ({ data }) => {
        if (!data.session?.access_token)
          throw new Error("Your sign-in session has expired.");
        const response = await fetch(
          `${apiConfig.baseUrl}/v1/accounts/${selectedAccountId}/price-freshness`,
          { headers: { authorization: `Bearer ${data.session.access_token}` } },
        );
        const payload: unknown = await response.json();
        if (!response.ok)
          throw new Error(
            payload && typeof payload === "object" && "error" in payload
              ? String(payload.error).replaceAll("_", " ")
              : "Freshness data is unavailable.",
          );
        if (
          active &&
          payload &&
          typeof payload === "object" &&
          "report" in payload
        )
          setFreshnessReport(
            (payload as { report: LiveFreshnessReport }).report,
          );
      })
      .catch((error) => {
        if (active)
          setFreshnessError(
            error instanceof Error
              ? error.message
              : "Freshness data is unavailable.",
          );
      })
      .finally(() => {
        if (active) setFreshnessLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiConfig, client, selectedAccountId, userId, freshnessRequestVersion]);

  useEffect(() => {
    if (!client || !apiConfig || !userId || !selectedAccountId) {
      setReportSnapshot(undefined);
      return;
    }
    let active = true;
    setReportLoading(true);
    setReportError(undefined);
    void client.auth
      .getSession()
      .then(async ({ data }) => {
        if (!data.session?.access_token) return;
        const response = await fetch(
          `${apiConfig.baseUrl}/v1/accounts/${selectedAccountId}/report`,
          { headers: { authorization: `Bearer ${data.session.access_token}` } },
        );
        if (response.status === 404) {
          if (active) setReportSnapshot(undefined);
          return;
        }
        const payload: unknown = await response.json();
        if (
          !response.ok ||
          !payload ||
          typeof payload !== "object" ||
          !("snapshot" in payload)
        )
          throw new Error("The persisted report is unavailable.");
        if (active)
          setReportSnapshot(
            (payload as { snapshot: LiveReportSnapshot }).snapshot,
          );
      })
      .catch((error) => {
        if (active) {
          setReportSnapshot(undefined);
          setReportError(
            error instanceof Error
              ? error.message
              : "The persisted report is unavailable.",
          );
        }
      })
      .finally(() => {
        if (active) setReportLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiConfig, client, selectedAccountId, userId, reportRequestVersion]);

  useEffect(() => {
    if (!client || !apiConfig || !userId || !selectedAccountId) {
      setActivityPage(undefined);
      setActivityError(undefined);
      setActivityLoading(false);
      setActivityOffset(0);
      return;
    }
    let active = true;
    setActivityLoading(true);
    setActivityError(undefined);
    void client.auth
      .getSession()
      .then(async ({ data }) => {
        if (!data.session?.access_token)
          throw new Error("Your sign-in session has expired.");
        const url = new URL(
          `${apiConfig.baseUrl}/v1/accounts/${selectedAccountId}/activity`,
        );
        url.searchParams.set("limit", "25");
        url.searchParams.set("offset", String(activityOffset));
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${data.session.access_token}` },
        });
        const payload: unknown = await response.json();
        if (!response.ok)
          throw new Error(
            payload && typeof payload === "object" && "error" in payload
              ? String(payload.error).replaceAll("_", " ")
              : "Activity data is unavailable.",
          );
        if (!payload || typeof payload !== "object" || !("activity" in payload))
          throw new Error("Activity data is unavailable.");
        if (active)
          setActivityPage((payload as { activity: LiveActivityPage }).activity);
      })
      .catch((error) => {
        if (active) {
          setActivityPage(undefined);
          setActivityError(
            error instanceof Error
              ? error.message
              : "Activity data is unavailable.",
          );
        }
      })
      .finally(() => {
        if (active) setActivityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    apiConfig,
    client,
    selectedAccountId,
    userId,
    activityOffset,
    activityRequestVersion,
  ]);

  async function createAccount(input: {
    name: string;
    accountType: LiveAccount["account_type"];
  }) {
    if (!client || !userId)
      throw new Error("Sign in before creating an account.");
    const { data, error } = await client
      .from("accounts")
      .insert({
        user_id: userId,
        brokerage: "robinhood",
        account_type: input.accountType,
        name: input.name.trim(),
        currency: "USD",
      })
      .select("id,name,account_type,brokerage,created_at")
      .single();
    if (error) throw new Error(error.message);
    setAccounts((current) => [...current, data as LiveAccount]);
    setSelectedAccountId((data as LiveAccount).id);
  }

  async function signOut() {
    await client?.auth.signOut({ scope: "global" });
    clearSessionWorkspaceState();
    window.location.assign("/");
  }

  async function downloadLiveExport(kind: "activity" | "report") {
    if (!client || !apiConfig || !selectedAccountId)
      throw new Error("Select an account before exporting.");
    const { data } = await client.auth.getSession();
    if (!data.session?.access_token)
      throw new Error(
        "Your sign-in session has expired. Sign in again before exporting.",
      );
    const response = await fetch(
      `${apiConfig.baseUrl}/v1/accounts/${selectedAccountId}/${kind}.csv`,
      { headers: { authorization: `Bearer ${data.session.access_token}` } },
    );
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => undefined);
      throw new Error(
        payload && typeof payload === "object" && "error" in payload
          ? String(payload.error).replaceAll("_", " ")
          : "This export is not available yet.",
      );
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      response.headers
        .get("content-disposition")
        ?.match(/filename="([^"]+)"/)?.[1] ?? `northstar-${kind}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function openBillingPortal() {
    if (!client || !apiConfig)
      throw new Error("Billing is not configured for this environment.");
    const { data } = await client.auth.getSession();
    if (!data.session?.access_token)
      throw new Error(
        "Your sign-in session has expired. Sign in again before managing billing.",
      );
    const response = await fetch(`${apiConfig.baseUrl}/v1/billing/portal`, {
      method: "POST",
      headers: { authorization: `Bearer ${data.session.access_token}` },
    });
    const payload: unknown = await response.json();
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object" ||
      !("url" in payload)
    )
      throw new Error("Billing is not available yet.");
    window.location.assign(String(payload.url));
  }

  async function requestDeletion() {
    if (!client || !apiConfig)
      throw new Error(
        "Account deletion is not configured for this environment.",
      );
    const { data } = await client.auth.getSession();
    if (!data.session?.access_token)
      throw new Error(
        "Your sign-in session has expired. Sign in again before requesting deletion.",
      );
    const response = await fetch(
      `${apiConfig.baseUrl}/v1/me/deletion-request`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${data.session.access_token}` },
      },
    );
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok)
      throw new Error(
        payload && typeof payload === "object" && "error" in payload
          ? String(payload.error).replaceAll("_", " ")
          : "Account deletion is not available yet.",
      );
  }

  function clearStaging() {
    setReviewOpen(false);
    setStagedActivities(null);
    setStagedFileName("");
    setLivePreview(undefined);
    setStagedCsv(undefined);
    setStageMessage(undefined);
    setStagedImportId(undefined);
    setLiveRows([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function stageFile(file?: File) {
    if (!file) return;
    setUploadError("");
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(
        "Choose a CSV smaller than 10 MB. This browser preview does not upload or save the file.",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (typeof reader.result !== "string")
          throw new Error("We could not read that CSV as text.");
        if (client && userId && selectedAccountId && apiConfig) {
          setIsStagingImport(true);
          const { data } = await client.auth.getSession();
          if (!data.session?.access_token)
            throw new Error(
              "Your sign-in session has expired. Sign in again before importing.",
            );
          const response = await fetch(
            `${apiConfig.baseUrl}/v1/accounts/${selectedAccountId}/import-preview`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${data.session.access_token}`,
                "content-type": "text/csv",
                "x-file-name": file.name,
              },
              body: reader.result,
            },
          );
          const payload: unknown = await response.json();
          if (
            !response.ok ||
            !payload ||
            typeof payload !== "object" ||
            !("import" in payload)
          )
            throw new Error("The server could not preview this CSV.");
          const preview = (payload as { import: LiveImportPreview }).import;
          setLivePreview(preview);
          setStagedCsv(reader.result);
          setStagedFileName(file.name);
          setReviewOpen(true);
          return;
        }
        setStagedActivities(parseRobinhoodCsv(reader.result));
        setStagedFileName(file.name);
        setReviewOpen(true);
      } catch (error) {
        setUploadError(
          error instanceof Error
            ? error.message
            : "We could not read that CSV.",
        );
      } finally {
        setIsStagingImport(false);
      }
    };
    reader.readAsText(file);
  }

  const openFileChooser = () => fileRef.current?.click();

  async function persistLiveImport() {
    if (
      !client ||
      !apiConfig ||
      !selectedAccountId ||
      !stagedCsv ||
      !livePreview
    )
      return;
    setStageMessage(undefined);
    setIsStagingImport(true);
    try {
      const { data } = await client.auth.getSession();
      if (!data.session?.access_token)
        throw new Error(
          "Your sign-in session has expired. Sign in again before importing.",
        );
      const response = await fetch(
        `${apiConfig.baseUrl}/v1/accounts/${selectedAccountId}/imports`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${data.session.access_token}`,
            "content-type": "text/csv",
            "x-file-name": stagedFileName,
          },
          body: stagedCsv,
        },
      );
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        !payload ||
        typeof payload !== "object" ||
        !("import" in payload)
      )
        throw new Error(
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : "The server could not stage this CSV.",
        );
      const importId = (payload as { import: { id: string } }).import.id;
      const detailResponse = await fetch(
        `${apiConfig.baseUrl}/v1/imports/${importId}`,
        { headers: { authorization: `Bearer ${data.session.access_token}` } },
      );
      const detail: unknown = await detailResponse.json();
      if (
        !detailResponse.ok ||
        !detail ||
        typeof detail !== "object" ||
        !("sourceRows" in detail) ||
        !Array.isArray(detail.sourceRows)
      )
        throw new Error(
          "The CSV was saved, but its review rows could not be loaded.",
        );
      setStagedImportId(importId);
      setLiveRows(detail.sourceRows as LiveImportRow[]);
      setHistoryVersion((current) => current + 1);
      setStageMessage(
        "Saved for review. This import has not changed your portfolio yet.",
      );
    } catch (error) {
      setStageMessage(
        error instanceof Error ? error.message : "We could not stage this CSV.",
      );
    } finally {
      setIsStagingImport(false);
    }
  }

  async function commitLiveImport() {
    if (!client || !apiConfig || !stagedImportId || !livePreview) return;
    setStageMessage(undefined);
    setIsStagingImport(true);
    try {
      const { data } = await client.auth.getSession();
      if (!data.session?.access_token)
        throw new Error(
          "Your sign-in session has expired. Sign in again before committing.",
        );
      const response = await fetch(
        `${apiConfig.baseUrl}/v1/imports/${stagedImportId}/commit`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${data.session.access_token}` },
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error).replaceAll("_", " ")
            : "The server could not commit this import.",
        );
      setHistoryVersion((current) => current + 1);
      setActivityRequestVersion((current) => current + 1);
      setStagedImportId(undefined);
      setStageMessage(
        "Import committed. Your reporting data will update after price and report processing are connected.",
      );
    } catch (error) {
      setStageMessage(
        error instanceof Error
          ? error.message
          : "We could not commit this import.",
      );
    } finally {
      setIsStagingImport(false);
    }
  }

  async function undoLiveImport(importId: string) {
    if (!client || !apiConfig)
      throw new Error("Sign in before undoing an import.");
    const { data } = await client.auth.getSession();
    if (!data.session?.access_token)
      throw new Error(
        "Your sign-in session has expired. Sign in again before undoing an import.",
      );
    const response = await fetch(
      `${apiConfig.baseUrl}/v1/imports/${importId}/undo`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${data.session.access_token}` },
      },
    );
    const payload: unknown = await response.json();
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object" ||
      !("import" in payload)
    )
      throw new Error(
        payload && typeof payload === "object" && "error" in payload
          ? String(payload.error).replaceAll("_", " ")
          : "This import could not be undone.",
      );
    setHistoryVersion((current) => current + 1);
    setActivityRequestVersion((current) => current + 1);
  }

  async function discardLiveImport() {
    if (!stagedImportId || !client || !apiConfig) {
      clearStaging();
      return;
    }
    setStageMessage(undefined);
    setIsStagingImport(true);
    try {
      const { data } = await client.auth.getSession();
      if (!data.session?.access_token)
        throw new Error(
          "Your sign-in session has expired. Sign in again before discarding this import.",
        );
      const response = await fetch(
        apiConfig.baseUrl + "/v1/imports/" + stagedImportId + "/discard",
        {
          method: "POST",
          headers: { authorization: "Bearer " + data.session.access_token },
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          payload && typeof payload === "object" && "error" in payload
            ? String(payload.error).replaceAll("_", " ")
            : "This review import could not be discarded.",
        );
      setHistoryVersion((current) => current + 1);
      clearStaging();
    } catch (error) {
      setStageMessage(
        error instanceof Error
          ? error.message
          : "This review import could not be discarded.",
      );
    } finally {
      setIsStagingImport(false);
    }
  }

  return authLoading ? (
    <SessionLoadingState />
  ) : (
    <main className="min-h-screen bg-[#f5f7fb] text-[#13233a]">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-[#f5f7fb]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 md:px-8">
          <Link
            className="flex items-center gap-2.5 font-bold tracking-tight"
            href="/"
          >
            <BrandMark size={32} />
            <span>northstar</span>
          </Link>
          {email ? (
            <div className="flex items-center gap-3">
              <Pill tone="green">Signed in · account workspace</Pill>
              <button
                onClick={signOut}
                className="text-sm font-bold text-[#185da8] hover:text-[#154f8e]"
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Pill tone="gold">Synthetic demo · no account connected</Pill>
              {client && (
                <Link
                  href="/sign-in"
                  className="text-sm font-bold text-[#185da8] hover:text-[#154f8e]"
                >
                  Sign in
                </Link>
              )}
            </div>
          )}
        </div>
      </header>
      <div className="mx-auto flex max-w-[1440px]">
        <aside
          className={`fixed inset-y-16 left-0 z-10 w-64 border-r border-slate-200 bg-white px-4 py-6 transition-transform md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Demo workspace
          </p>
          <nav aria-label="Portfolio sections" className="space-y-1">
            {nav.map(([label, Icon]) => (
              <button
                key={label}
                onClick={() => {
                  setActive(label);
                  setMenuOpen(false);
                }}
                aria-current={active === label ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${active === label ? "bg-[#eaf2ff] text-[#1d4a7d]" : "text-slate-500 hover:bg-slate-50"}`}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-8 rounded-2xl bg-[#152b4a] p-4 text-white">
            <p className="text-sm font-semibold">Prototype notice</p>
            <p className="mt-2 text-xs leading-5 text-slate-300">
              This preview uses only synthetic data. Imports are inspected in
              this browser and are not stored or used for reporting.
            </p>
          </div>
          <span className="mt-5 flex w-full items-center gap-3 px-3 text-sm font-semibold text-slate-400">
            <Landmark size={18} />
            Settings coming later
          </span>
        </aside>
        <section id="top" className="min-w-0 flex-1 px-4 py-7 md:px-8 md:py-10">
          <button
            onClick={() => setMenuOpen(true)}
            className="mb-5 grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white md:hidden"
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>
          {active === "Overview" && (
            <Overview
              summary={summary}
              onUpload={openFileChooser}
              onOpenAccounts={() => setActive("Accounts")}
              freshnessReport={freshnessReport}
              freshnessLoading={freshnessLoading}
              freshnessError={freshnessError}
              onRetryFreshness={() =>
                setFreshnessRequestVersion((value) => value + 1)
              }
              reportSnapshot={reportSnapshot}
              reportLoading={reportLoading}
              reportError={reportError}
              onRetryReport={() =>
                setReportRequestVersion((value) => value + 1)
              }
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              onSelectAccount={setSelectedAccountId}
              reportPeriod={reportPeriod}
              onSelectReportPeriod={setReportPeriod}
              reportScope={reportScope}
              onSelectReportScope={setReportScope}
              openingHistory={openingHistory}
              isLiveAccount={Boolean(client && userId && selectedAccountId)}
            />
          )}
          {active === "Activity" && (
            <ActivityPanel
              onUpload={openFileChooser}
              isLiveAccount={Boolean(client && userId && selectedAccountId)}
              activityPage={activityPage}
              isLoading={activityLoading}
              loadError={activityError}
              onRetry={() => setActivityRequestVersion((value) => value + 1)}
              onPrevious={() =>
                setActivityOffset((value) => Math.max(0, value - 25))
              }
              onNext={() => setActivityOffset((value) => value + 25)}
              filter={activityFilter}
              onFilterChange={setActivityFilter}
            />
          )}
          {active === "Accounts" && (
            <Accounts
              summary={summary}
              accounts={accounts}
              isLoading={accountsLoading}
              loadError={accountsError}
              onRetry={() => setAccountsRequestVersion((value) => value + 1)}
              canCreate={Boolean(client && userId)}
              onCreate={createAccount}
              selectedAccountId={selectedAccountId}
              openingHistory={openingHistory}
              openingHistoryLoading={openingHistoryLoading}
              onSaveOpeningHistory={saveOpeningHistory}
            />
          )}
          {active === "Documents" && (
            <Documents
              onUpload={openFileChooser}
              uploadError={uploadError}
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              onSelectAccount={setSelectedAccountId}
              canStage={Boolean(
                client && userId && apiConfig && selectedAccountId,
              )}
              isStaging={isStagingImport}
              importHistory={importHistory}
              historyLoading={historyLoading}
              onUndo={undoLiveImport}
            />
          )}
          {active === "Settings" && (
            <SettingsPanel
              email={email}
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              onSelectAccount={setSelectedAccountId}
              onExportActivity={() => downloadLiveExport("activity")}
              onExportReport={() => downloadLiveExport("report")}
              onOpenBilling={openBillingPortal}
              onRequestDeletion={requestDeletion}
              billingStatus={billingStatus}
            />
          )}
        </section>
      </div>
      <Input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-label="Preview a Robinhood CSV"
        onChange={(event) => stageFile(event.target.files?.[0])}
      />
      <ImportReview
        open={reviewOpen}
        fileName={stagedFileName}
        activities={stagedActivities ?? []}
        livePreview={livePreview}
        liveRows={liveRows}
        stagedImportId={stagedImportId}
        isStaging={isStagingImport}
        stageMessage={stageMessage}
        onStage={persistLiveImport}
        onCommit={commitLiveImport}
        onDiscard={discardLiveImport}
      />
    </main>
  );
}

function Overview({
  summary,
  onUpload,
  onOpenAccounts,
  freshnessReport,
  freshnessLoading,
  freshnessError,
  onRetryFreshness,
  reportSnapshot,
  reportLoading,
  reportError,
  onRetryReport,
  accounts,
  selectedAccountId,
  onSelectAccount,
  reportPeriod,
  onSelectReportPeriod,
  reportScope,
  onSelectReportScope,
  openingHistory,
  isLiveAccount,
}: {
  summary: ReturnType<typeof calculateSummary>;
  onUpload: () => void;
  onOpenAccounts: () => void;
  freshnessReport?: LiveFreshnessReport;
  freshnessLoading: boolean;
  freshnessError?: string;
  onRetryFreshness: () => void;
  reportSnapshot?: LiveReportSnapshot;
  reportLoading: boolean;
  reportError?: string;
  onRetryReport: () => void;
  accounts: LiveAccount[];
  selectedAccountId?: string;
  onSelectAccount: (accountId: string) => void;
  reportPeriod: ReportPeriod;
  onSelectReportPeriod: (period: ReportPeriod) => void;
  reportScope: "account" | "consolidated";
  onSelectReportScope: (scope: "account" | "consolidated") => void;
  openingHistory?: OpeningHistory;
  isLiveAccount: boolean;
}) {
  const liveValue = reportSnapshot?.payload.totalValue;
  const liveCash = reportSnapshot?.payload.cash;
  const liveReturn = reportSnapshot?.payload.timeWeightedReturn;
  const liveDividends = reportSnapshot?.payload.dividendIncome;
  const liveRealized = reportSnapshot?.payload.realizedGainLoss;
  const liveNetDeposits = reportSnapshot?.payload.netDeposits;
  const hasLiveReport = Boolean(reportSnapshot);
  const showDemo = !isLiveAccount;
  const chartData = hasLiveReport
    ? filterReportHistory(
        reportSnapshot?.payload.valueHistory ?? [],
        reportPeriod,
      ).map((point) => ({
        date: point.date,
        value: point.value === null ? null : Number(point.value),
      }))
    : showDemo
      ? demoPrices
      : [];
  const dashboardWarnings = getDashboardWarnings({
    isLiveAccount,
    reportLoading,
    reportError,
    report: reportSnapshot
      ? {
          asOfDate: reportSnapshot.asOfDate,
          totalValue: reportSnapshot.payload.totalValue,
          holdings: reportSnapshot.payload.holdings,
        }
      : undefined,
    freshness: freshnessReport
      ? {
          expectedDate: freshnessReport.expectedDate,
          rows: freshnessReport.rows,
        }
      : undefined,
    openingHistory,
  });
  return (
    <>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Pill tone={hasLiveReport ? "green" : "gold"}>
            {hasLiveReport
              ? "Your account"
              : showDemo
                ? "Demo data"
                : "Awaiting report"}
          </Pill>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            {hasLiveReport || isLiveAccount
              ? "Portfolio overview"
              : "Portfolio example"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {hasLiveReport
              ? `As of ${reportSnapshot?.asOfDate}. Values come from your persisted report snapshot.`
              : showDemo
                ? "A fictional long-term portfolio used to preview the product."
                : "No persisted report is available for this account yet."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {accounts.length > 0 && (
            <label className="text-xs font-semibold text-slate-500">
              Account
              <select
                aria-label="Select account for report"
                value={selectedAccountId ?? accounts[0].id}
                onChange={(event) => onSelectAccount(event.target.value)}
                className="ml-2 h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-[#185da8] focus:ring-2 focus:ring-[#185da8]/20"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isLiveAccount && (
            <label className="text-xs font-semibold text-slate-500">
              Scope
              <select
                aria-label="Select report scope"
                value={reportScope}
                onChange={(event) =>
                  onSelectReportScope(
                    event.target.value as "account" | "consolidated",
                  )
                }
                className="ml-2 h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-[#185da8] focus:ring-2 focus:ring-[#185da8]/20"
              >
                <option value="account">This account</option>
                <option value="consolidated" disabled>
                  All accounts (coming soon)
                </option>
              </select>
            </label>
          )}
          {hasLiveReport && (
            <label className="text-xs font-semibold text-slate-500">
              Chart period
              <select
                aria-label="Select report chart period"
                value={reportPeriod}
                onChange={(event) =>
                  onSelectReportPeriod(event.target.value as ReportPeriod)
                }
                className="ml-2 h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-[#185da8] focus:ring-2 focus:ring-[#185da8]/20"
              >
                {reportPeriodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            onClick={onUpload}
            className="h-11 rounded-xl bg-[#185da8] px-5 text-white hover:bg-[#154f8e]"
          >
            <Upload size={17} />
            Preview a CSV
          </Button>
        </div>
      </div>
      {(freshnessLoading || freshnessError || freshnessReport) && (
        <section className="mb-7 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">Stored price freshness</p>
              <p className="mt-1 text-xs text-slate-500">
                Expected through {freshnessReport?.expectedDate ?? "—"}
              </p>
            </div>
            {freshnessLoading && <Pill>Checking…</Pill>}
            {freshnessError && <Pill tone="gold">Unavailable</Pill>}
            {freshnessReport && !freshnessLoading && (
              <div className="flex gap-2 text-xs font-semibold">
                <Pill tone="green">
                  {
                    freshnessReport.rows.filter(
                      (row) => row.status === "current",
                    ).length
                  }{" "}
                  current
                </Pill>
                <Pill tone="gold">
                  {
                    freshnessReport.rows.filter((row) => row.status === "stale")
                      .length
                  }{" "}
                  stale
                </Pill>
                <Pill>
                  {
                    freshnessReport.rows.filter(
                      (row) => row.status === "missing",
                    ).length
                  }{" "}
                  missing
                </Pill>
              </div>
            )}
          </div>
          {freshnessError && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-amber-800">{freshnessError}</p>
              <button
                type="button"
                onClick={onRetryFreshness}
                className="text-sm font-bold text-[#185da8] underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          )}
          {freshnessReport && freshnessReport.rows.length > 0 && (
            <ul
              aria-label="Price freshness by symbol"
              className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {freshnessReport.rows.map((row) => (
                <li
                  key={`${row.symbol}-${row.expectedDate}`}
                  className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs"
                >
                  <span className="font-bold text-slate-700">{row.symbol}</span>
                  <span
                    className={
                      row.status === "current"
                        ? "font-semibold text-emerald-700"
                        : row.status === "stale"
                          ? "font-semibold text-amber-700"
                          : "font-semibold text-slate-500"
                    }
                  >
                    {row.status === "current"
                      ? `Current · ${row.latestDate}`
                      : row.status === "stale"
                        ? `Stale · ${row.latestDate ?? "no close"}`
                        : "Missing · no close"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {reportLoading && (
        <section className="mb-7 rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
          Loading your persisted report…
        </section>
      )}
      {reportError && (
        <section
          role="alert"
          className="mb-7 flex flex-wrap items-center gap-3 rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800"
        >
          <span>{reportError}</span>
          <button
            type="button"
            onClick={onRetryReport}
            className="font-bold underline underline-offset-2"
          >
            Retry
          </button>
        </section>
      )}
      {dashboardWarnings.length > 0 && (
        <DashboardWarningList
          warnings={dashboardWarnings}
          onUpload={onUpload}
          onOpenAccounts={onOpenAccounts}
          onRetryReport={onRetryReport}
        />
      )}
      {hasLiveReport && (
        <section
          aria-label="Report coverage"
          className="mb-7 grid gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Activity covered through
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {reportSnapshot?.payload.activityCoveredThrough ?? "Unavailable"}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Prices through
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {reportSnapshot?.payload.pricesThrough ?? "Unavailable"}
            </p>
          </div>
        </section>
      )}
      {hasLiveReport && (
        <section
          aria-label="Report methodology"
          className="mb-7 rounded-3xl border border-sky-200 bg-sky-50 p-5 text-sm text-sky-950 shadow-sm"
        >
          <p className="font-bold">How these figures are calculated</p>
          <p className="mt-2 leading-6">
            {reportSnapshot?.payload.methodology?.disclosure ??
              "Daily returns use Modified Dietz intervals. External cash flows are approximated at the midpoint of their day, missing valuation periods remain unavailable, and returns are not annualized."}
          </p>
          <p className="mt-2 text-xs font-semibold text-sky-800">
            Realized gains/losses are analytical FIFO estimates and are not tax
            reporting.
          </p>
        </section>
      )}
      <div className="mb-7 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.85fr)]">
        <section className="overflow-hidden rounded-3xl bg-[#152b4a] p-6 text-white shadow-[0_18px_55px_rgba(21,43,74,.16)] md:p-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="mb-3 text-sm font-semibold text-slate-300">
                {showDemo
                  ? "Example portfolio value"
                  : `Portfolio value · ${reportPeriodDescription(reportPeriod)}`}
              </p>
              <h2 className="text-4xl font-semibold tracking-tight md:text-5xl">
                {liveValue != null
                  ? precise.format(Number(liveValue))
                  : showDemo
                    ? fmt.format(summary.value)
                    : "—"}
              </h2>
              <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
                <ArrowUpRight size={17} />
                {liveReturn != null
                  ? `${(Number(liveReturn) * 100).toFixed(1)}% stored return`
                  : showDemo
                    ? `${precise.format(summary.gain)} (${summary.returnPercent.toFixed(1)}%) in this example`
                    : "Return unavailable until a report is published"}
              </p>
            </div>
            <Pill tone={hasLiveReport ? "green" : "gold"}>
              {hasLiveReport ? "Persisted" : "Synthetic"}
            </Pill>
          </div>
          {hasLiveReport && (
            <p className="mt-2 text-xs text-slate-300">
              The chart window changes with the selected period. Headline
              metrics use the latest stored report.
            </p>
          )}
          <div className="mt-8 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="value" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#93c5fd"
                  strokeWidth={2.5}
                  fill="url(#value)"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#93a9c2", fontSize: 12 }}
                />
                <YAxis hide domain={["dataMin - 400", "dataMax + 300"]} />
                <Tooltip
                  formatter={(value) => fmt.format(Number(value))}
                  contentStyle={{
                    borderRadius: 12,
                    border: "none",
                    background: "#fff",
                    color: "#13233a",
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {isLiveAccount && chartData.length === 0 && (
            <p className="mt-2 text-xs text-slate-300">
              No persisted valuation history is available yet.
            </p>
          )}
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">
            {showDemo ? "Example return" : "Your return"}
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-emerald-600">
            {liveReturn != null
              ? `${(Number(liveReturn) * 100).toFixed(1)}%`
              : showDemo
                ? `+${summary.returnPercent.toFixed(1)}%`
                : "—"}
          </p>
          <div className="my-6 border-t border-slate-100" />
          <div className="grid grid-cols-2 gap-5">
            <Metric
              label="Dividends"
              value={
                liveDividends == null
                  ? showDemo
                    ? precise.format(summary.dividends)
                    : "—"
                  : precise.format(Number(liveDividends))
              }
            />
            <Metric
              label="Realized gains"
              value={
                liveRealized == null
                  ? showDemo
                    ? precise.format(summary.realized)
                    : "—"
                  : precise.format(Number(liveRealized))
              }
            />
            <Metric
              label="Cash balance"
              value={
                liveCash != null
                  ? precise.format(Number(liveCash))
                  : showDemo
                    ? precise.format(summary.cash)
                    : "—"
              }
            />
            <Metric
              label="Price source"
              value={showDemo ? "Not connected" : "Stored daily closes"}
              small
            />
          </div>
        </section>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.75fr)]">
        <Holdings
          liveHoldings={reportSnapshot?.payload.holdings}
          isLiveAccount={isLiveAccount}
        />
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-bold">
              {showDemo ? "Example income" : "Dividend income"}
            </h2>
            <HandCoins size={20} className="text-[#185da8]" />
          </div>
          <p className="text-3xl font-bold tracking-tight">
            {liveDividends == null
              ? showDemo
                ? precise.format(summary.dividends)
                : "—"
              : precise.format(Number(liveDividends))}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {liveDividends == null
              ? showDemo
                ? "Synthetic dividends in this scenario"
                : "No persisted dividend report yet"
              : "Income recorded from your imported activity"}
          </p>
        </section>
      </div>
      <ReportDetails
        isLiveAccount={isLiveAccount}
        totalValue={liveValue ?? null}
        cash={liveCash ?? null}
        netDeposits={liveNetDeposits ?? null}
        holdings={reportSnapshot?.payload.holdings}
        realizedSales={reportSnapshot?.payload.realizedSales}
      />
    </>
  );
}

function DashboardWarningList({
  warnings,
  onUpload,
  onOpenAccounts,
  onRetryReport,
}: {
  warnings: DashboardWarning[];
  onUpload: () => void;
  onOpenAccounts: () => void;
  onRetryReport: () => void;
}) {
  return (
    <section aria-label="Portfolio notices" className="mb-7 space-y-3">
      {warnings.map((warning) => (
        <article
          key={warning.kind}
          role={warning.kind === "unavailable_prices" ? "alert" : undefined}
          className={`rounded-3xl border p-5 text-sm shadow-sm ${warningClass(warning.kind)}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-bold">{warning.title}</p>
              <p className="mt-1 max-w-3xl leading-6">{warning.message}</p>
            </div>
            <button
              type="button"
              onClick={
                warning.action === "import"
                  ? onUpload
                  : warning.action === "accounts"
                    ? onOpenAccounts
                    : onRetryReport
              }
              className="shrink-0 font-bold underline underline-offset-2"
            >
              {warning.action === "import"
                ? "Import activity"
                : warning.action === "accounts"
                  ? "Review opening history"
                  : "Check again"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function warningClass(kind: DashboardWarning["kind"]) {
  if (kind === "unavailable_prices")
    return "border-amber-200 bg-amber-50 text-amber-950";
  if (kind === "stale_report")
    return "border-amber-200 bg-amber-50 text-amber-900";
  if (kind === "partial_history")
    return "border-sky-200 bg-sky-50 text-sky-950";
  if (kind === "no_holdings")
    return "border-slate-200 bg-slate-50 text-slate-800";
  return "border-blue-200 bg-blue-50 text-blue-950";
}

function ReportDetails({
  isLiveAccount,
  totalValue,
  cash,
  netDeposits,
  holdings,
  realizedSales,
}: {
  isLiveAccount: boolean;
  totalValue: string | null;
  cash: string | null;
  netDeposits: string | null;
  holdings?: LiveReportHolding[];
  realizedSales?: LiveRealizedSale[];
}) {
  const rows = buildAllocationRows(holdings ?? [], cash, totalValue);
  const hasReport = totalValue !== null || holdings !== undefined;
  const sales = realizedSales ?? [];
  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <section
        aria-label="Capital and allocation"
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Capital & allocation</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Portfolio composition from the latest stored valuation.
            </p>
          </div>
          <PieChart size={20} className="text-[#185da8]" />
        </div>
        <div className="mb-6 grid grid-cols-2 gap-4">
          <Metric
            label="Net deposits"
            value={
              netDeposits === null
                ? isLiveAccount
                  ? "—"
                  : "Unavailable"
                : precise.format(Number(netDeposits))
            }
          />
          <Metric
            label="Invested value"
            value={
              totalValue === null
                ? isLiveAccount
                  ? "—"
                  : "Unavailable"
                : precise.format(
                    Math.max(0, Number(totalValue) - Number(cash ?? 0)),
                  )
            }
          />
        </div>
        {!hasReport && isLiveAccount && (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
            Allocation becomes available after a report snapshot is published.
          </p>
        )}
        {hasReport && rows.length === 0 && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Allocation is unavailable because the latest valuation is
            incomplete.
          </p>
        )}
        {rows.length > 0 && (
          <ul aria-label="Portfolio allocation" className="space-y-4">
            {rows.map((row) => (
              <li key={row.key}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-700">
                    {row.label}
                  </span>
                  <span className="font-bold text-slate-800">
                    {row.unavailable
                      ? "Unavailable"
                      : `${row.percentage.toFixed(1)}%`}
                  </span>
                </div>
                {!row.unavailable && (
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-[#4f8ac9]"
                      style={{
                        width: `${Math.min(100, Math.max(0, row.percentage))}%`,
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        aria-label="Realized lot detail"
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-5">
          <h2 className="text-lg font-bold">Realized lot detail</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            FIFO analytical matches for completed sales. Not tax reporting.
          </p>
        </div>
        {isLiveAccount && realizedSales === undefined && (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
            Lot matches will appear after a report with realized sale detail is
            published.
          </p>
        )}
        {isLiveAccount && realizedSales !== undefined && sales.length === 0 && (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
            No completed sales in the latest report.
          </p>
        )}
        {!isLiveAccount && (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
            Realized lot detail is unavailable in the synthetic example.
          </p>
        )}
        {sales.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="pb-3">Date</th>
                  <th className="pb-3">Instrument</th>
                  <th className="pb-3 text-right">Qty</th>
                  <th className="pb-3 text-right">Gain / loss</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr
                    key={sale.eventId}
                    className="border-b border-slate-50 last:border-0"
                  >
                    <td className="py-3 text-sm text-slate-500">{sale.date}</td>
                    <td className="py-3 text-sm font-bold">
                      {sale.instrumentId}
                    </td>
                    <td className="py-3 text-right text-sm">{sale.quantity}</td>
                    <td
                      className={`py-3 text-right text-sm font-bold ${sale.gainLoss === null ? "text-slate-500" : Number(sale.gainLoss) >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {sale.gainLoss === null
                        ? "Basis unavailable"
                        : precise.format(Number(sale.gainLoss))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Holdings({
  liveHoldings,
  isLiveAccount,
}: {
  liveHoldings?: LiveReportHolding[];
  isLiveAccount: boolean;
}) {
  if (isLiveAccount && !liveHoldings)
    return (
      <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500 shadow-sm">
        Holdings will appear after a persisted report is published for this
        account.
      </section>
    );
  if (liveHoldings)
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="text-lg font-bold">Your holdings</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Persisted quantities and stored closes as of the latest report.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[610px] text-left">
            <thead className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pb-3">Instrument</th>
                <th className="pb-3">Shares</th>
                <th className="pb-3">Stored close</th>
                <th className="pb-3 text-right">Stored value</th>
              </tr>
            </thead>
            <tbody>
              {liveHoldings.map((holding) => (
                <tr
                  key={holding.instrumentId}
                  className="border-b border-slate-50 last:border-0"
                >
                  <td className="py-4 text-sm font-bold">
                    <span>{holding.displayName ?? holding.instrumentId}</span>
                    {holding.displayName && (
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        {holding.instrumentId}
                      </span>
                    )}
                  </td>
                  <td className="py-4 text-sm font-semibold">
                    {holding.quantity}
                  </td>
                  <td className="py-4 text-sm font-semibold">
                    {holding.close === null
                      ? "Missing"
                      : precise.format(Number(holding.close))}
                  </td>
                  <td className="py-4 text-right text-sm font-bold">
                    {holding.value === null
                      ? "Unavailable"
                      : precise.format(Number(holding.value))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-bold">Example holdings</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          These are not live prices or connected positions.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[610px] text-left">
          <thead className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="pb-3">Holding</th>
              <th className="pb-3">Shares</th>
              <th className="pb-3">Example price</th>
              <th className="pb-3 text-right">Example value</th>
            </tr>
          </thead>
          <tbody>
            {demoHoldings.map((holding) => (
              <tr
                key={holding.symbol}
                className="border-b border-slate-50 last:border-0"
              >
                <td className="py-4">
                  <p className="font-bold">{holding.symbol}</p>
                  <p className="max-w-40 truncate text-xs text-slate-500">
                    {holding.name}
                  </p>
                </td>
                <td className="py-4 text-sm font-semibold">{holding.shares}</td>
                <td className="py-4 text-sm font-semibold">
                  {precise.format(holding.price)}
                </td>
                <td className="py-4 text-right text-sm font-bold">
                  {precise.format(holding.shares * holding.price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActivityPanel({
  onUpload,
  isLiveAccount,
  activityPage,
  isLoading,
  loadError,
  onRetry,
  onPrevious,
  onNext,
  filter,
  onFilterChange,
}: {
  onUpload: () => void;
  isLiveAccount: boolean;
  activityPage?: LiveActivityPage;
  isLoading: boolean;
  loadError?: string;
  onRetry: () => void;
  onPrevious: () => void;
  onNext: () => void;
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  if (isLiveAccount)
    return (
      <>
        <div className="mb-8 flex items-end justify-between">
          <div>
            <Pill tone="green">Your account</Pill>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Activity</h1>
            <p className="mt-2 text-sm text-slate-500">
              Imported ledger entries from your selected account.
            </p>
          </div>
          <Button
            onClick={onUpload}
            className="rounded-xl bg-[#185da8] text-white"
          >
            <Plus size={16} />
            Import CSV
          </Button>
        </div>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label
              htmlFor="activity-filter"
              className="text-sm font-semibold text-slate-700"
            >
              Filter activity
            </label>
            <Input
              id="activity-filter"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder="Type, symbol, or description"
              className="w-full sm:max-w-xs"
            />
          </div>
          {loadError && (
            <div
              role="alert"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
            >
              <span>{loadError}</span>
              <Button
                onClick={onRetry}
                className="rounded-lg bg-white text-rose-700 hover:bg-rose-100"
              >
                Retry
              </Button>
            </div>
          )}
          {isLoading && !activityPage ? (
            <div className="grid min-h-64 place-items-center text-center">
              <div>
                <Clock3
                  className="mx-auto animate-pulse text-[#185da8]"
                  size={28}
                />
                <p className="mt-4 text-sm text-slate-500">
                  Loading your activity…
                </p>
              </div>
            </div>
          ) : activityPage &&
            activityPage.items.filter((item) =>
              `${item.entryType} ${item.instrumentId ?? ""} ${item.description}`
                .toLowerCase()
                .includes(filter.trim().toLowerCase()),
            ).length > 0 ? (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm text-slate-500">
                  Showing entries {activityPage.offset + 1}–
                  {activityPage.offset + activityPage.items.length}
                  {isLoading ? " · Updating…" : ""}
                </p>
                <p className="text-xs text-slate-400">
                  Source rows remain available for review
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="pb-3">Date</th>
                      <th className="pb-3">Activity</th>
                      <th className="pb-3">Instrument</th>
                      <th className="pb-3">Details</th>
                      <th className="pb-3">Source</th>
                      <th className="pb-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityPage.items
                      .filter((item) =>
                        `${item.entryType} ${item.instrumentId ?? ""} ${item.description}`
                          .toLowerCase()
                          .includes(filter.trim().toLowerCase()),
                      )
                      .map((item) => (
                        <LiveActivityRow key={item.id} item={item} />
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                <Button
                  disabled={activityPage.offset === 0 || isLoading}
                  onClick={onPrevious}
                  className="rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                >
                  Previous
                </Button>
                <span className="text-xs font-semibold text-slate-400">
                  Page{" "}
                  {Math.floor(activityPage.offset / activityPage.limit) + 1}
                </span>
                <Button
                  disabled={!activityPage.hasMore || isLoading}
                  onClick={onNext}
                  className="rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                >
                  Next
                </Button>
              </div>
            </>
          ) : loadError ? null : (
            <div className="grid min-h-64 place-items-center text-center">
              <div>
                <Clock3 className="mx-auto text-[#185da8]" size={28} />
                <h2 className="mt-5 text-xl font-bold">
                  {filter.trim()
                    ? "No matching activity"
                    : "No imported activity yet"}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                  {filter.trim()
                    ? "Try a different type, symbol, or description."
                    : "Import a Robinhood activity CSV to populate this account’s ledger."}
                </p>
                {!filter.trim() && (
                  <Button
                    onClick={onUpload}
                    className="mt-5 rounded-xl bg-[#185da8] text-white"
                  >
                    <Plus size={16} />
                    Import CSV
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      </>
    );
  return (
    <>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <Pill tone="gold">Demo data</Pill>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            Example activity
          </h1>
        </div>
        <Button
          onClick={onUpload}
          className="rounded-xl bg-[#185da8] text-white"
        >
          <Plus size={16} />
          Preview CSV
        </Button>
      </div>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-5 text-sm text-slate-500">
          Synthetic transactions only. A CSV preview is not saved and does not
          affect this example.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[660px] text-left">
            <thead className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pb-3">Date</th>
                <th className="pb-3">Activity</th>
                <th className="pb-3">Symbol</th>
                <th className="pb-3">Details</th>
                <th className="pb-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {demoActivities
                .slice()
                .reverse()
                .map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-slate-50 last:border-0"
                  >
                    <td className="py-4 text-sm text-slate-500">{item.date}</td>
                    <td className="py-4">
                      <Pill tone={item.kind === "dividend" ? "green" : "slate"}>
                        {item.kind.replace("_", " ")}
                      </Pill>
                    </td>
                    <td className="py-4 text-sm font-bold">
                      {item.symbol ?? "—"}
                    </td>
                    <td className="py-4 text-sm text-slate-500">
                      {item.description}
                    </td>
                    <td
                      className={`py-4 text-right text-sm font-bold ${item.amount >= 0 ? "text-emerald-600" : ""}`}
                    >
                      {item.amount >= 0 ? "+" : ""}
                      {precise.format(item.amount)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function LiveActivityRow({ item }: { item: AccountActivity }) {
  const amount = Number(item.cashAmount);
  const entryType = item.entryType.replaceAll("_", " ");
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="py-4 text-sm text-slate-500">{item.effectiveDate}</td>
      <td className="py-4">
        <Pill tone={item.entryType === "dividend" ? "green" : "slate"}>
          {entryType}
        </Pill>
      </td>
      <td className="py-4 text-sm font-semibold">
        {item.instrumentId ? `${item.instrumentId.slice(0, 8)}…` : "Cash"}
      </td>
      <td className="py-4 text-sm text-slate-500">{item.description}</td>
      <td className="py-4 text-xs text-slate-400">
        {item.sourceRow ? `Row ${item.sourceRow.rowNumber}` : "System entry"}
      </td>
      <td
        className={`py-4 text-right text-sm font-bold ${amount >= 0 ? "text-emerald-600" : "text-slate-700"}`}
      >
        {amount >= 0 ? "+" : ""}
        {precise.format(amount)}
      </td>
    </tr>
  );
}

function Accounts({
  summary,
  accounts,
  isLoading,
  loadError,
  onRetry,
  canCreate,
  onCreate,
  selectedAccountId,
  openingHistory,
  openingHistoryLoading,
  onSaveOpeningHistory,
}: {
  summary: ReturnType<typeof calculateSummary>;
  accounts: LiveAccount[];
  isLoading: boolean;
  loadError?: string;
  onRetry: () => void;
  canCreate: boolean;
  onCreate: (input: {
    name: string;
    accountType: LiveAccount["account_type"];
  }) => Promise<void>;
  selectedAccountId?: string;
  openingHistory?: OpeningHistory;
  openingHistoryLoading: boolean;
  onSaveOpeningHistory: (history: OpeningHistory) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [accountType, setAccountType] =
    useState<LiveAccount["account_type"]>("individual");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setError("Give this account a name.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onCreate({ name, accountType });
      setName("");
      setAccountType("individual");
      setOpen(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "We could not create that account.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!canCreate)
    return (
      <>
        <div className="mb-8">
          <Pill tone="gold">Demo data</Pill>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            Example account
          </h1>
        </div>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <CircleDollarSign size={23} />
            </span>
            <div className="flex-1">
              <p className="font-bold">Example taxable brokerage</p>
              <p className="mt-0.5 text-sm text-slate-500">
                Fictional account · no brokerage connected
              </p>
            </div>
            <p className="text-xl font-bold">{fmt.format(summary.value)}</p>
          </div>
        </section>
      </>
    );

  return (
    <>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Pill tone="green">Your accounts</Pill>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Accounts</h1>
          <p className="mt-2 text-sm text-slate-500">
            Accounts are stored securely. Values appear after a committed import
            and price coverage.
          </p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="rounded-xl bg-[#185da8] text-white"
        >
          <Plus size={16} />
          Add account
        </Button>
      </div>
      {loadError ? (
        <section
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800 shadow-sm"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={onRetry}
            className="font-bold underline underline-offset-2"
          >
            Retry
          </button>
        </section>
      ) : isLoading ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Loading your accounts…
        </section>
      ) : accounts.length === 0 ? (
        <section className="grid min-h-64 place-items-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div>
            <WalletCards className="mx-auto text-[#185da8]" size={28} />
            <h2 className="mt-4 text-xl font-bold">
              Add your Robinhood account
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              Choose the account type before you upload its activity CSV. Your
              imported activity stays separate by account.
            </p>
            <Button
              onClick={() => setOpen(true)}
              className="mt-5 rounded-xl bg-[#185da8] text-white"
            >
              Add account
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            {accounts.map((account) => (
              <article
                key={account.id}
                className="flex items-center gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <CircleDollarSign size={23} />
                </span>
                <div className="flex-1">
                  <p className="font-bold">{account.name}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Robinhood · {accountTypeLabel(account.account_type)}
                  </p>
                </div>
                <p className="text-sm font-semibold text-slate-500">
                  No live valuation yet
                </p>
              </article>
            ))}
          </section>
          {selectedAccountId && (
            <OpeningHistoryEditor
              history={openingHistory}
              loading={openingHistoryLoading}
              onSave={onSaveOpeningHistory}
            />
          )}
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl bg-white p-6 md:p-8">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              Add a Robinhood account
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Select the account that matches the activity CSV you plan to
              import.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label
              htmlFor="account-name"
              className="block text-sm font-semibold text-slate-700"
            >
              Account name
              <Input
                id="account-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Taxable brokerage"
                className="mt-1.5 h-11 rounded-xl"
              />
            </label>
            <label
              htmlFor="account-type"
              className="block text-sm font-semibold text-slate-700"
            >
              Account type
              <select
                id="account-type"
                value={accountType}
                onChange={(event) =>
                  setAccountType(
                    event.target.value as LiveAccount["account_type"],
                  )
                }
                className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#185da8] focus:ring-2 focus:ring-[#185da8]/20"
              >
                <option value="individual">Individual brokerage</option>
                <option value="traditional_ira">Traditional IRA</option>
                <option value="roth_ira">Roth IRA</option>
              </select>
            </label>
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
              >
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={submit}
              className="rounded-xl bg-[#185da8] text-white"
            >
              {saving ? "Creating…" : "Create account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OpeningHistoryEditor({
  history,
  loading,
  onSave,
}: {
  history?: OpeningHistory;
  loading: boolean;
  onSave: (history: OpeningHistory) => Promise<void>;
}) {
  const [cash, setCash] = useState(history?.openingCash ?? "0");
  const [coveredFrom, setCoveredFrom] = useState(
    history?.activityCoveredFrom ?? "",
  );
  const [reason, setReason] = useState(history?.incompleteReason ?? "");
  const [positions, setPositions] = useState(
    JSON.stringify(history?.positions ?? [], null, 2),
  );
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    setCash(history?.openingCash ?? "0");
    setCoveredFrom(history?.activityCoveredFrom ?? "");
    setReason(history?.incompleteReason ?? "");
    setPositions(JSON.stringify(history?.positions ?? [], null, 2));
  }, [history]);
  async function submit() {
    try {
      setMessage(undefined);
      const parsed = JSON.parse(positions);
      await onSave({
        openingCash: cash as OpeningHistory["openingCash"],
        activityCoveredFrom: coveredFrom
          ? (coveredFrom as OpeningHistory["activityCoveredFrom"])
          : null,
        incompleteReason: reason || null,
        positions: parsed,
      });
      setMessage("Opening history saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Opening history could not be saved.",
      );
    }
  }
  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Pill tone="slate">Incomplete history</Pill>
          <h2 className="mt-3 text-xl font-bold">Opening balances and lots</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Record what your first statement does not include. Leave acquisition
            dates or basis null when unknown and explain the gap.
          </p>
        </div>
        <Button
          type="button"
          disabled={loading}
          onClick={submit}
          className="rounded-xl bg-[#185da8] text-white"
        >
          Save opening history
        </Button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">
          Opening cash
          <input
            value={cash}
            onChange={(event) => setCash(event.target.value)}
            inputMode="decimal"
            className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Activity covered from
          <input
            type="date"
            value={coveredFrom}
            onChange={(event) => setCoveredFrom(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"
          />
        </label>
      </div>
      <label className="mt-4 block text-sm font-semibold text-slate-700">
        Incomplete-history explanation
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal"
          placeholder="Example: imported history begins after account opening."
        />
      </label>
      <label className="mt-4 block text-sm font-semibold text-slate-700">
        Opening lots (JSON)
        <textarea
          value={positions}
          onChange={(event) => setPositions(event.target.value)}
          rows={6}
          className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs font-normal"
          aria-describedby="opening-lots-help"
        />
        <span
          id="opening-lots-help"
          className="mt-1 block text-xs font-normal text-slate-500"
        >
          Each item uses instrumentId, quantity, acquiredOn, and totalCostBasis.
          Use null for unknown date or basis.
        </span>
      </label>
      {message && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          {message}
        </p>
      )}
    </section>
  );
}

function accountTypeLabel(accountType: LiveAccount["account_type"]) {
  return {
    individual: "Individual brokerage",
    traditional_ira: "Traditional IRA",
    roth_ira: "Roth IRA",
  }[accountType];
}

function Documents({
  onUpload,
  uploadError,
  accounts,
  selectedAccountId,
  onSelectAccount,
  canStage,
  isStaging,
  importHistory,
  historyLoading,
  onUndo,
}: {
  onUpload: () => void;
  uploadError: string;
  accounts: LiveAccount[];
  selectedAccountId?: string;
  onSelectAccount: (accountId: string) => void;
  canStage: boolean;
  isStaging: boolean;
  importHistory: LiveImportSummary[];
  historyLoading: boolean;
  onUndo: (importId: string) => Promise<void>;
}) {
  const live = accounts.length > 0;
  const [undoError, setUndoError] = useState<string>();
  const [undoing, setUndoing] = useState<string>();
  const latestCommittedId = importHistory
    .filter((item) => item.status === "committed")
    .sort((left, right) =>
      (right.committedAt ?? "").localeCompare(left.committedAt ?? ""),
    )[0]?.id;
  async function undo(importId: string) {
    setUndoing(importId);
    setUndoError(undefined);
    try {
      await onUndo(importId);
    } catch (error) {
      setUndoError(
        error instanceof Error
          ? error.message
          : "This import could not be undone.",
      );
    } finally {
      setUndoing(undefined);
    }
  }
  return (
    <>
      <div className="mb-8">
        <Pill tone={live ? "green" : "gold"}>
          {live ? "Secure staged import" : "Local preview only"}
        </Pill>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          {live ? "Import activity" : "CSV preview"}
        </h1>
      </div>
      <section className="grid min-h-80 place-items-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <div>
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eaf2ff] text-[#185da8]">
            <FileUp size={25} />
          </span>
          <h2 className="mt-5 text-xl font-bold">
            {live
              ? "Review a Robinhood activity CSV"
              : "Preview a Robinhood activity CSV"}
          </h2>
          {live ? (
            <>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                The Worker validates this CSV and saves it for your review.
                Nothing affects your portfolio until you commit the reviewed
                import.
              </p>
              <label className="mx-auto mt-5 block max-w-sm text-left text-sm font-semibold text-slate-700">
                Account
                <select
                  value={selectedAccountId ?? ""}
                  onChange={(event) => onSelectAccount(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="" disabled>
                    Select an account
                  </option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {accountTypeLabel(account.account_type)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              This early prototype reads a selected CSV in your browser only to
              show a temporary interpretation. It does not upload, store, or add
              the rows to a portfolio.
            </p>
          )}
          <Button
            disabled={isStaging || (live && !canStage)}
            onClick={onUpload}
            className="mt-6 rounded-xl bg-[#185da8] text-white"
          >
            <Upload size={16} />
            {isStaging ? "Reading CSV…" : "Choose CSV"}
          </Button>
          {uploadError && (
            <p
              role="alert"
              className="mx-auto mt-4 max-w-md rounded-xl bg-amber-50 p-3 text-sm text-amber-800"
            >
              {uploadError}
            </p>
          )}
          <p className="mt-4 text-xs text-slate-400">
            CSV only · Up to 10 MB ·{" "}
            {live
              ? "Server-side validation and review"
              : "Temporary browser preview"}
          </p>
        </div>
      </section>
      {live && (
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-bold">Import history</h2>
            <p className="mt-1 text-sm text-slate-500">
              Only the latest committed import can be undone.
            </p>
          </div>
          {undoError && (
            <p
              role="alert"
              className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
            >
              {undoError}
            </p>
          )}
          {historyLoading ? (
            <p className="text-sm text-slate-500">Loading imports…</p>
          ) : importHistory.length === 0 ? (
            <p className="text-sm text-slate-500">
              No imports for this account yet.
            </p>
          ) : (
            <div className="space-y-3">
              {importHistory.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 p-4"
                >
                  <div className="min-w-40 flex-1">
                    <p className="font-semibold">{item.fileName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {item.sourceRowCount} rows · {item.warningCount} warnings
                    </p>
                  </div>
                  <Pill
                    tone={
                      item.status === "committed"
                        ? "green"
                        : item.status === "ready_for_review"
                          ? "gold"
                          : "slate"
                    }
                  >
                    {item.status.replaceAll("_", " ")}
                  </Pill>
                  {item.id === latestCommittedId && (
                    <Button
                      disabled={undoing === item.id}
                      onClick={() => void undo(item.id)}
                      className="rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
                    >
                      {undoing === item.id ? "Undoing…" : "Undo"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ImportReview({
  open,
  fileName,
  activities,
  livePreview,
  liveRows,
  stagedImportId,
  isStaging,
  stageMessage,
  onStage,
  onCommit,
  onDiscard,
}: {
  open: boolean;
  fileName: string;
  activities: Activity[];
  livePreview?: LiveImportPreview;
  liveRows: LiveImportRow[];
  stagedImportId?: string;
  isStaging: boolean;
  stageMessage?: string;
  onStage: () => Promise<void>;
  onCommit: () => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const warnings = activities.filter((activity) => activity.warning).length;
  const review = livePreview?.review;
  const liveWarnings = review
    ? review.unsupportedRowCount +
      review.invalidRowCount +
      review.duplicateRowCount
    : 0;
  const canCommit = Boolean(
    stagedImportId &&
    review &&
    !livePreview?.duplicateFile &&
    review.acceptedRowCount > 0 &&
    liveWarnings === 0,
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isStaging) void onDiscard();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-auto rounded-3xl bg-white p-6 shadow-2xl md:p-8">
        <DialogHeader>
          <Pill tone={livePreview ? "green" : "gold"}>
            {livePreview ? "Server-side review" : "Temporary browser preview"}
          </Pill>
          <DialogTitle className="mt-3 text-2xl font-bold">
            Review parsed rows
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            {livePreview
              ? `${fileName || "Selected CSV"} has been parsed securely but is not yet committed to your portfolio.`
              : `${fileName || "Selected CSV"} was not uploaded or saved. These rows cannot affect the demo portfolio.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <Metric
            label="Rows found"
            value={String(review?.sourceRowCount ?? activities.length)}
          />
          <Metric
            label="Interpreted"
            value={String(
              review?.acceptedRowCount ?? activities.length - warnings,
            )}
          />
          <Metric
            label="Needs review"
            value={String(review ? liveWarnings : warnings)}
          />
        </div>
        {livePreview?.duplicateFile && (
          <p
            role="alert"
            className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800"
          >
            This exact file was already imported for this account.
          </p>
        )}
        {(liveWarnings > 0 || warnings > 0) && (
          <p
            role="alert"
            className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800"
          >
            Some rows need review. They remain visible and cannot silently
            change reports.
          </p>
        )}
        {liveRows.length > 0 && (
          <div
            aria-live="polite"
            className="max-h-52 overflow-auto rounded-xl border border-slate-200"
          >
            <table className="min-w-[38rem] w-full text-left text-sm">
              <caption className="sr-only">
                Imported activity rows and validation results
              </caption>
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="p-3">
                    Row
                  </th>
                  <th scope="col" className="p-3">
                    Status
                  </th>
                  <th scope="col" className="p-3">
                    Activity
                  </th>
                  <th scope="col" className="p-3">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody>
                {liveRows.slice(0, 50).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="p-3">{row.rowNumber}</td>
                    <td className="p-3">
                      <Pill
                        tone={row.status === "supported" ? "green" : "gold"}
                      >
                        {row.status}
                      </Pill>
                    </td>
                    <td className="p-3">
                      {typeof row.normalizedPayload?.type === "string"
                        ? row.normalizedPayload.type
                        : "—"}
                    </td>
                    <td className="p-3 text-slate-500">{row.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!livePreview && (
          <div className="max-h-52 overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-[24rem] w-full text-left text-sm">
              <caption className="sr-only">Parsed activity preview</caption>
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="p-3">
                    Date
                  </th>
                  <th scope="col" className="p-3">
                    Type
                  </th>
                  <th scope="col" className="p-3">
                    Symbol
                  </th>
                </tr>
              </thead>
              <tbody>
                {activities.slice(0, 20).map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="p-3">{item.date}</td>
                    <td className="p-3">{item.kind}</td>
                    <td className="p-3">{item.symbol ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {stageMessage && (
          <output
            aria-live="polite"
            className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {stageMessage}
          </output>
        )}
        <DialogFooter className="mt-3 rounded-b-2xl">
          {livePreview && !stagedImportId && (
            <Button
              disabled={isStaging || livePreview.duplicateFile}
              onClick={() => void onStage()}
              className="rounded-xl bg-[#185da8] text-white"
            >
              {isStaging ? "Saving…" : "Save for review"}{" "}
              <ChevronRight size={16} />
            </Button>
          )}
          {canCommit && !stageMessage && (
            <Button
              disabled={isStaging}
              onClick={() => void onCommit()}
              className="rounded-xl bg-[#185da8] text-white"
            >
              {isStaging ? "Committing…" : "Commit import"}{" "}
              <ChevronRight size={16} />
            </Button>
          )}
          <Button
            disabled={isStaging}
            onClick={() => void onDiscard()}
            className="rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            {stageMessage ? "Done" : "Discard preview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  label,
  value,
  small = false,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={`mt-1 font-bold ${small ? "text-base" : "text-lg"}`}>
        {value}
      </p>
    </div>
  );
}
