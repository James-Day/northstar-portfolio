'use client';

import { ArrowRight, CheckCircle2, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';

export function SignInPage() {
  return <main className="grid min-h-screen bg-[#f5f7fb] lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden overflow-hidden bg-[#152b4a] p-12 text-white lg:block">
      <Link href="/" className="relative z-10 flex items-center gap-2.5 font-bold tracking-tight"><BrandMark inverse /><span>northstar</span></Link>
      <div className="relative z-10 mx-auto mt-36 max-w-md"><p className="text-sm font-bold text-sky-300">Portfolio clarity, in development</p><h1 className="mt-4 text-5xl font-bold tracking-[-0.05em]">Your whole portfolio, in focus.</h1><p className="mt-5 text-lg leading-8 text-slate-300">The live account experience is being built. You can explore a clearly labeled synthetic portfolio while we implement secure authentication and data storage.</p><div className="mt-10 space-y-4 text-sm font-semibold text-slate-200"><p className="flex items-center gap-3"><CheckCircle2 size={19} className="text-emerald-300"/>No brokerage connection in this prototype</p><p className="flex items-center gap-3"><CheckCircle2 size={19} className="text-emerald-300"/>CSV previews stay in this browser session</p></div></div>
    </section>
    <section className="flex min-h-screen flex-col px-6 py-7 sm:px-12 lg:px-16"><div className="flex items-center justify-between"><Link href="/" className="flex items-center gap-2.5 font-bold"><BrandMark size={32}/><span>northstar</span></Link><Link href="/" className="text-sm font-bold text-[#185da8]">Learn more</Link></div><div className="mx-auto my-auto w-full max-w-sm"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#eaf2ff] text-[#185da8]"><LockKeyhole size={20}/></span><h1 className="mt-6 text-3xl font-bold tracking-tight">Sign-in is coming soon</h1><p className="mt-2 text-base leading-7 text-slate-600">Secure email and Google authentication will be added with the database and server-side session controls. This page does not accept credentials yet.</p><Link href="/dashboard" className="mt-8 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#185da8] px-4 text-sm font-semibold text-white hover:bg-[#154f8e]">Explore the synthetic demo <ArrowRight size={16}/></Link><p className="mt-6 text-center text-xs leading-5 text-slate-500">Do not enter a real password here. The demo has no account, trial, payment, or stored personal data.</p></div></section>
  </main>;
}
