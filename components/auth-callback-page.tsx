'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { createPublicSupabaseClient } from '@/services/supabase/client';
import { readOAuthCallbackError } from '@/lib/auth/oauth-callback';

type PublicSupabaseConfig = { url: string; anonKey: string };

export function AuthCallbackPage({ supabaseConfig }: { supabaseConfig?: PublicSupabaseConfig }) {
  const [message, setMessage] = useState('Confirming your session…');
  const client = useMemo(() => supabaseConfig ? createPublicSupabaseClient(supabaseConfig) : undefined, [supabaseConfig]);

  useEffect(() => {
    const callbackError = readOAuthCallbackError(window.location.search, window.location.hash);
    if (callbackError) {
      setMessage(callbackError);
      return;
    }
    if (!client) {
      setMessage('Northstar authentication has not been configured yet.');
      return;
    }
    let active = true;
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (session) window.location.replace('/dashboard');
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (!active || data.session) return;
      setMessage(error?.message ?? 'This link is expired or invalid. Request a new link and try again.');
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client]);

  return <main className="grid min-h-screen place-items-center bg-[#f5f7fb] px-6"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><Link href="/" className="flex items-center gap-2.5 font-bold text-slate-900"><BrandMark size={32}/><span>northstar</span></Link><h1 className="mt-8 text-2xl font-bold tracking-tight text-slate-900">Finishing sign-in</h1><p role="status" className="mt-3 text-base leading-7 text-slate-600">{message}</p><Link href="/sign-in" className="mt-7 inline-flex text-sm font-bold text-[#185da8] hover:text-[#154f8e]">Return to sign in</Link></section></main>;
}
