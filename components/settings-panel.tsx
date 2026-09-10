"use client";

import { useState } from "react";
import { CreditCard, Download, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type SettingsAccount = { id: string; name: string };
type BillingStatus = { status: 'inactive' | 'trialing' | 'active' | 'past_due' | 'canceled'; allowed: boolean; reason: 'active' | 'trialing' | 'trial_expired' | 'past_due' | 'canceled' | 'inactive'; trialEndsAt: string | null };

export function SettingsPanel({
  email,
  accounts,
  selectedAccountId,
  onSelectAccount,
  onExportActivity,
  onExportReport,
  onOpenBilling,
  onRequestDeletion,
  billingStatus,
}: {
  email?: string;
  accounts: SettingsAccount[];
  selectedAccountId?: string;
  onSelectAccount: (accountId: string) => void;
  onExportActivity: () => Promise<void>;
  onExportReport: () => Promise<void>;
  onOpenBilling: () => Promise<void>;
  onRequestDeletion: () => Promise<void>;
  billingStatus?: BillingStatus;
}) {
  const [action, setAction] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function run(name: string, callback: () => Promise<void>) {
    setAction(name);
    setMessage(undefined);
    setError(undefined);
    try {
      await callback();
      if (name === "deletion") setMessage("Your deletion request was submitted for review.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That settings action could not be completed.");
    } finally {
      setAction(undefined);
    }
  }

  if (!email) {
    return (
      <>
        <div className="mb-8">
          <span className="inline-flex rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-800">Demo data</span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Settings</h1>
        </div>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold">Sign in to manage your data</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Exports, billing and deletion requests are available only for an authenticated account. This synthetic demo does not store any of the data you preview.</p>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="mb-8">
        <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">Account settings</span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-slate-500">Signed in as {email}. Manage your exports, subscription and privacy requests.</p>
      </div>
      {message && <p role="status" className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#eaf2ff] text-[#185da8]"><Download size={20} /></span>
            <div><h2 className="text-lg font-bold">Export your data</h2><p className="mt-1 text-sm leading-6 text-slate-500">Download a spreadsheet copy of your imported activity or the latest persisted report.</p></div>
          </div>
          <label className="mt-5 block text-sm font-semibold text-slate-700">Account<select value={selectedAccountId ?? ""} onChange={(event) => onSelectAccount(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#185da8] focus:ring-2 focus:ring-[#185da8]/20"><option value="" disabled>Select an account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" disabled={!selectedAccountId || Boolean(action)} onClick={() => run("activity", onExportActivity)} className="rounded-xl bg-[#185da8] text-white">{action === "activity" ? "Preparing…" : "Export activity"}</Button>
            <Button type="button" variant="outline" disabled={!selectedAccountId || Boolean(action)} onClick={() => run("report", onExportReport)} className="rounded-xl">{action === "report" ? "Preparing…" : "Export report"}</Button>
          </div>
          <p className="mt-4 flex gap-2 text-xs leading-5 text-slate-400"><ShieldCheck size={15} className="mt-0.5 shrink-0" />Exports are generated from your account-scoped records. Spreadsheet formula values are escaped.</p>
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700"><CreditCard size={20} /></span><div><h2 className="text-lg font-bold">Subscription</h2><p className="mt-1 text-sm leading-6 text-slate-500">Update payment details, invoices or cancellation through Stripe’s hosted billing portal.</p>{billingStatus && <p className={`mt-3 text-sm font-semibold ${billingStatus.allowed ? "text-emerald-700" : "text-amber-700"}`} role="status">{billingStatus.reason === "trialing" ? `14-day trial · ends ${new Date(billingStatus.trialEndsAt ?? "").toLocaleDateString()}` : billingStatus.reason === "active" ? "Subscription active" : billingStatus.reason === "past_due" ? "Payment failed · update your payment method" : billingStatus.reason === "canceled" ? "Subscription canceled" : billingStatus.reason === "trial_expired" ? "Trial ended · choose a plan to continue" : "No active subscription"}</p>}</div></div>
          <Button type="button" variant="outline" disabled={Boolean(action)} onClick={() => run("billing", onOpenBilling)} className="mt-5 rounded-xl">{action === "billing" ? "Opening…" : "Manage billing"}</Button>
        </section>
        <section className="rounded-3xl border border-rose-200 bg-rose-50/60 p-6 shadow-sm lg:col-span-2">
          <div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-100 text-rose-700"><Trash2 size={20} /></span><div><h2 className="text-lg font-bold text-slate-900">Delete account data</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">A deletion request removes your profile, normalized activity, reports and private brokerage files after the durable cleanup process completes. Raw uploaded files are otherwise removed automatically after 30 days. This action cannot be undone.</p></div></div>
          <Button type="button" variant="destructive" disabled={Boolean(action)} onClick={() => { if (window.confirm("Request deletion of your Northstar account and portfolio data? This cannot be undone.")) void run("deletion", onRequestDeletion); }} className="mt-5 rounded-xl">{action === "deletion" ? "Submitting…" : "Request account deletion"}</Button>
        </section>
      </div>
    </>
  );
}
