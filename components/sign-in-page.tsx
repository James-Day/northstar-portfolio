'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { createSupabaseAuthService } from '@/services/auth/supabase-auth';
import { createPublicSupabaseClient } from '@/services/supabase/client';
import { buildAuthRedirectUrl } from '@/lib/auth/redirects';
import { establishBrowserSession } from '@/lib/auth/session-handoff';
import { userFacingAuthError } from '@/lib/auth/user-facing-error';

type PublicSupabaseConfig = { url: string; anonKey: string };
type Mode = 'sign-in' | 'sign-up';

export function SignInPage({ supabaseConfig, authRedirectOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'] }: { supabaseConfig?: PublicSupabaseConfig; authRedirectOrigins?: readonly string[] }) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => setIsHydrated(true), []);
  const client = useMemo(() => supabaseConfig ? createPublicSupabaseClient(supabaseConfig) : undefined, [supabaseConfig]);
  const auth = useMemo(() => client ? createSupabaseAuthService(client.auth) : undefined, [client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    setMessage(undefined);
    setIsSubmitting(true);
    try {
      if (mode === 'sign-up') {
        await auth.signUp({ email, password }, buildAuthRedirectUrl(window.location.origin, 'callback', authRedirectOrigins));
        setMessage('Check your email to confirm your account, then return here to sign in.');
      } else {
        await auth.signIn({ email, password });
        const { data } = await client!.auth.getSession();
        if (!data.session?.access_token) throw new Error('We could not establish the private workspace session.');
        if (!await establishBrowserSession(data.session.access_token)) throw new Error('We could not establish the private workspace session.');
        window.location.assign('/dashboard');
      }
    } catch (error) {
      setMessage(userFacingAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function startGoogleSignIn() {
    if (!auth) return;
    setMessage(undefined);
    setIsSubmitting(true);
    try {
      await auth.startGoogleSignIn(buildAuthRedirectUrl(window.location.origin, 'callback', authRedirectOrigins));
    } catch (error) {
      setMessage(userFacingAuthError(error, 'Google sign-in could not start. Please try again or use email and password.'));
      setIsSubmitting(false);
    }
  }

  async function resetPassword() {
    if (!auth) return;
    setMessage(undefined);
    setIsSubmitting(true);
    try {
      await auth.sendPasswordReset(email, buildAuthRedirectUrl(window.location.origin, 'recovery', authRedirectOrigins));
      setMessage('If that email has an account, a password-reset link is on its way.');
    } catch (error) {
      setMessage(userFacingAuthError(error, 'Password reset could not start.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main id="auth-content" data-auth-client={isHydrated ? 'ready' : 'loading'} className="grid min-h-screen bg-[#f5f7fb] lg:grid-cols-[1.05fr_.95fr]">
    <a href="#auth-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-bold focus:text-[#185da8] focus:shadow-lg">Skip to content</a>
    <section className="relative hidden overflow-hidden bg-[#152b4a] p-12 text-white lg:block">
      <Link href="/" className="relative z-10 flex items-center gap-2.5 font-bold tracking-tight"><BrandMark inverse /><span>northstar</span></Link>
      <div className="relative z-10 mx-auto mt-36 max-w-md"><p className="text-sm font-bold text-sky-300">Portfolio clarity, in development</p><h1 className="mt-4 text-5xl font-bold tracking-[-0.05em]">Your whole portfolio, in focus.</h1><p className="mt-5 text-lg leading-8 text-slate-300">The live account experience is being built. You can explore a clearly labeled synthetic portfolio while we implement secure authentication and data storage.</p><div className="mt-10 space-y-4 text-sm font-semibold text-slate-200"><p className="flex items-center gap-3"><CheckCircle2 size={19} className="text-emerald-300"/>No brokerage connection in this prototype</p><p className="flex items-center gap-3"><CheckCircle2 size={19} className="text-emerald-300"/>CSV previews stay in this browser session</p></div></div>
    </section>
    <section className="flex min-h-screen flex-col px-6 py-7 sm:px-12 lg:px-16"><div className="flex items-center justify-between"><Link href="/" className="flex items-center gap-2.5 font-bold"><BrandMark size={32}/><span>northstar</span></Link><Link href="/" className="text-sm font-bold text-[#185da8]">Learn more</Link></div><div className="mx-auto my-auto w-full max-w-sm"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#eaf2ff] text-[#185da8]"><LockKeyhole size={20}/></span>{auth ? <><h1 className="mt-6 text-3xl font-bold tracking-tight">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h1><p className="mt-2 text-base leading-7 text-slate-600">{mode === 'sign-in' ? 'Sign in to manage your Northstar portfolio.' : 'Start with a secure account before importing activity.'}</p><form className="mt-7 space-y-4" onSubmit={submit}><label className="block text-sm font-semibold text-slate-700">Email<input className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-[#185da8] focus:ring-2 focus:ring-[#185da8]/20" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className="block text-sm font-semibold text-slate-700">Password<input className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-[#185da8] focus:ring-2 focus:ring-[#185da8]/20" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{message && <p role="status" className="rounded-xl bg-slate-100 px-3 py-2 text-sm leading-5 text-slate-700">{message}</p>}<button type="submit" disabled={isSubmitting} className="flex h-11 w-full items-center justify-center rounded-xl bg-[#185da8] px-4 text-sm font-semibold text-white hover:bg-[#154f8e] disabled:opacity-60">{isSubmitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button></form><button type="button" onClick={startGoogleSignIn} disabled={isSubmitting} aria-label="Continue with Google" className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5"><path fill="#4285F4" d="M21.35 12.23c0-.74-.07-1.46-.21-2.15H12v4.07h5.23a4.47 4.47 0 0 1-1.94 2.93v2.42h3.14c1.84-1.7 2.92-4.2 2.92-7.27Z"/><path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.35l-3.14-2.42c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.29v2.5A9.74 9.74 0 0 0 12 21.6Z"/><path fill="#FBBC05" d="M6.54 13.72A5.85 5.85 0 0 1 6.23 12c0-.6.11-1.18.31-1.72v-2.5H3.29A9.74 9.74 0 0 0 2.25 12c0 1.57.38 3.05 1.04 4.22l3.25-2.5Z"/><path fill="#EA4335" d="M12 6.25c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.21 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.71 5.38l3.25 2.5c.77-2.31 2.92-4.03 5.46-4.03Z"/></svg>Continue with Google</button><div className="mt-5 flex items-center justify-between text-sm font-semibold"><button type="button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(undefined); }} className="text-[#185da8]">{mode === 'sign-in' ? 'Create an account' : 'I already have an account'}</button>{mode === 'sign-in' && <button type="button" onClick={resetPassword} disabled={isSubmitting} className="text-slate-600 hover:text-[#185da8]">Forgot password?</button>}</div></> : <><h1 className="mt-6 text-3xl font-bold tracking-tight">Sign-in is being configured</h1><p className="mt-2 text-base leading-7 text-slate-600">Secure authentication will appear here after Northstar is connected to Supabase. This screen does not collect credentials until that connection is ready.</p></>}<Link href="/demo" className="mt-8 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#185da8] px-4 text-sm font-semibold text-white hover:bg-[#154f8e]">Explore the synthetic demo <ArrowRight size={16}/></Link><p className="mt-6 text-center text-xs leading-5 text-slate-500">The demo has no account, trial, payment, or stored personal data.</p></div></section>
  </main>;
}
