"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { createPublicSupabaseClient } from "@/services/supabase/client";
import { createSupabaseAuthService } from "@/services/auth/supabase-auth";

type PublicSupabaseConfig = { url: string; anonKey: string };

export function PasswordRecoveryPage({ supabaseConfig }: { supabaseConfig?: PublicSupabaseConfig }) {
  const client = useMemo(() => supabaseConfig ? createPublicSupabaseClient(supabaseConfig) : undefined, [supabaseConfig]);
  const auth = useMemo(() => client ? createSupabaseAuthService(client.auth) : undefined, [client]);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      setHasSession(Boolean(data.session));
      if (sessionError) setError(sessionError.message);
      else if (!data.session) setError("This recovery link is expired or invalid. Request a new link.");
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setHasSession(Boolean(session));
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [client]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setMessage(undefined);
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    if (!auth || !hasSession) { setError("This recovery session is no longer valid. Request a new link."); return; }
    setSubmitting(true);
    try {
      await auth.updatePassword(password);
      setPassword("");
      setConfirmation("");
      setMessage("Password updated. You can now sign in with your new password.");
      await client?.auth.signOut({ scope: "global" });
      setHasSession(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Password could not be updated.");
    } finally { setSubmitting(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-[#f5f7fb] px-6"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><Link href="/" className="flex items-center gap-2.5 font-bold text-slate-900"><BrandMark size={32}/><span>northstar</span></Link><span className="mt-8 grid h-11 w-11 place-items-center rounded-2xl bg-[#eaf2ff] text-[#185da8]"><LockKeyhole size={20}/></span><h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">Set a new password</h1><p className="mt-2 text-base leading-7 text-slate-600">Choose a new password with at least 12 characters.</p>{message && <p role="status" className="mt-5 rounded-xl bg-emerald-50 px-3 py-2 text-sm leading-5 text-emerald-800">{message}</p>}{error && <p role="alert" className="mt-5 rounded-xl bg-rose-50 px-3 py-2 text-sm leading-5 text-rose-800">{error}</p>}{hasSession && !message && <form className="mt-7 space-y-4" onSubmit={submit}><label className="block text-sm font-semibold text-slate-700">New password<input className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-[#185da8] focus:ring-2 focus:ring-[#185da8]/20" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label className="block text-sm font-semibold text-slate-700">Confirm new password<input className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-[#185da8] focus:ring-2 focus:ring-[#185da8]/20" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label><button disabled={submitting} className="flex h-11 w-full items-center justify-center rounded-xl bg-[#185da8] px-4 text-sm font-semibold text-white hover:bg-[#154f8e] disabled:opacity-60">{submitting ? "Updating…" : "Update password"}</button></form>}<Link href="/sign-in" className="mt-7 inline-flex text-sm font-bold text-[#185da8] hover:text-[#154f8e]">Return to sign in</Link></section></main>;
}
