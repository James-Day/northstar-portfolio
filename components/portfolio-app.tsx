'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, ChartNoAxesCombined, ChevronRight, CircleDollarSign, Clock3, FileUp, HandCoins, Landmark, Menu, Plus, Upload, WalletCards } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Activity, calculateSummary, demoActivities, demoHoldings, demoPrices, parseRobinhoodCsv } from '@/lib/portfolio';
import { createPublicSupabaseClient } from '@/services/supabase/client';

type PublicSupabaseConfig = { url: string; anonKey: string };

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const precise = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const nav = [['Overview', ChartNoAxesCombined], ['Accounts', WalletCards], ['Activity', Clock3], ['Documents', FileUp]] as const;

function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'gold' }) {
  const tones = { slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-500/10 text-emerald-700', gold: 'bg-amber-400/15 text-amber-800' };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function PortfolioApp({ supabaseConfig }: { supabaseConfig?: PublicSupabaseConfig }) {
  const [active, setActive] = useState('Overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [stagedActivities, setStagedActivities] = useState<Activity[] | null>(null);
  const [stagedFileName, setStagedFileName] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const summary = useMemo(() => calculateSummary(demoActivities), []);
  const client = useMemo(() => supabaseConfig ? createPublicSupabaseClient(supabaseConfig) : undefined, [supabaseConfig]);
  const [email, setEmail] = useState<string>();

  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => setEmail(session?.user.email));
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client]);

  async function signOut() {
    await client?.auth.signOut();
    window.location.assign('/');
  }

  function clearStaging() {
    setReviewOpen(false);
    setStagedActivities(null);
    setStagedFileName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function stageFile(file?: File) {
    if (!file) return;
    setUploadError('');
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Choose a CSV smaller than 10 MB. This browser preview does not upload or save the file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (typeof reader.result !== 'string') throw new Error('We could not read that CSV as text.');
        setStagedActivities(parseRobinhoodCsv(reader.result));
        setStagedFileName(file.name);
        setReviewOpen(true);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : 'We could not read that CSV.');
      }
    };
    reader.readAsText(file);
  }

  const openFileChooser = () => fileRef.current?.click();

  return <main className="min-h-screen bg-[#f5f7fb] text-[#13233a]">
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-[#f5f7fb]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 md:px-8">
        <Link className="flex items-center gap-2.5 font-bold tracking-tight" href="/"><BrandMark size={32} /><span>northstar</span></Link>
        {email ? <div className="flex items-center gap-3"><Pill tone="gold">Synthetic demo · your portfolio is separate</Pill><button onClick={signOut} className="text-sm font-bold text-[#185da8] hover:text-[#154f8e]">Sign out</button></div> : <div className="flex items-center gap-3"><Pill tone="gold">Synthetic demo · no account connected</Pill>{client && <Link href="/sign-in" className="text-sm font-bold text-[#185da8] hover:text-[#154f8e]">Sign in</Link>}</div>}
      </div>
    </header>
    <div className="mx-auto flex max-w-[1440px]">
      <aside className={`fixed inset-y-16 left-0 z-10 w-64 border-r border-slate-200 bg-white px-4 py-6 transition-transform md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Demo workspace</p>
        <nav className="space-y-1">{nav.map(([label, Icon]) => <button key={label} onClick={() => { setActive(label); setMenuOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${active === label ? 'bg-[#eaf2ff] text-[#1d4a7d]' : 'text-slate-500 hover:bg-slate-50'}`}><Icon size={18} />{label}</button>)}</nav>
        <div className="mt-8 rounded-2xl bg-[#152b4a] p-4 text-white"><p className="text-sm font-semibold">Prototype notice</p><p className="mt-2 text-xs leading-5 text-slate-300">This preview uses only synthetic data. Imports are inspected in this browser and are not stored or used for reporting.</p></div>
        <span className="mt-5 flex w-full items-center gap-3 px-3 text-sm font-semibold text-slate-400"><Landmark size={18} />Settings coming later</span>
      </aside>
      <section id="top" className="min-w-0 flex-1 px-4 py-7 md:px-8 md:py-10">
        <button onClick={() => setMenuOpen(true)} className="mb-5 grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white md:hidden" aria-label="Open navigation"><Menu size={18} /></button>
        {active === 'Overview' && <Overview summary={summary} onUpload={openFileChooser} />}
        {active === 'Activity' && <ActivityPanel onUpload={openFileChooser} />}
        {active === 'Accounts' && <Accounts summary={summary} />}
        {active === 'Documents' && <Documents onUpload={openFileChooser} uploadError={uploadError} />}
      </section>
    </div>
    <Input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Preview a Robinhood CSV" onChange={(event) => stageFile(event.target.files?.[0])} />
    <ImportReview open={reviewOpen} fileName={stagedFileName} activities={stagedActivities ?? []} onDiscard={clearStaging} />
  </main>;
}

function Overview({ summary, onUpload }: { summary: ReturnType<typeof calculateSummary>; onUpload: () => void }) {
  return <>
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><Pill tone="gold">Demo data</Pill><h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Portfolio example</h1><p className="mt-2 text-sm text-slate-500">A fictional long-term portfolio used to preview the product.</p></div><Button onClick={onUpload} className="h-11 rounded-xl bg-[#185da8] px-5 text-white hover:bg-[#154f8e]"><Upload size={17} />Preview a CSV</Button></div>
    <div className="mb-7 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.85fr)]"><section className="overflow-hidden rounded-3xl bg-[#152b4a] p-6 text-white shadow-[0_18px_55px_rgba(21,43,74,.16)] md:p-8"><div className="flex items-start justify-between"><div><p className="mb-3 text-sm font-semibold text-slate-300">Example portfolio value</p><h2 className="text-4xl font-semibold tracking-tight md:text-5xl">{fmt.format(summary.value)}</h2><p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-300"><ArrowUpRight size={17} />{precise.format(summary.gain)} ({summary.returnPercent.toFixed(1)}%) in this example</p></div><Pill tone="gold">Synthetic</Pill></div><div className="mt-8 h-44"><ResponsiveContainer width="100%" height="100%"><AreaChart data={demoPrices}><defs><linearGradient id="value" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity={.4}/><stop offset="100%" stopColor="#60a5fa" stopOpacity={0}/></linearGradient></defs><Area type="monotone" dataKey="value" stroke="#93c5fd" strokeWidth={2.5} fill="url(#value)"/><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#93a9c2', fontSize: 12 }} /><YAxis hide domain={['dataMin - 400', 'dataMax + 300']} /><Tooltip formatter={(value) => fmt.format(Number(value))} contentStyle={{ borderRadius: 12, border: 'none', background: '#fff', color: '#13233a' }} /></AreaChart></ResponsiveContainer></div></section><section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-semibold text-slate-500">Example return</p><p className="mt-2 text-3xl font-bold tracking-tight text-emerald-600">+{summary.returnPercent.toFixed(1)}%</p><div className="my-6 border-t border-slate-100"/><div className="grid grid-cols-2 gap-5"><Metric label="Dividends" value={precise.format(summary.dividends)}/><Metric label="Realized gains" value={precise.format(summary.realized)}/><Metric label="Cash balance" value={precise.format(summary.cash)}/><Metric label="Price source" value="Not connected" small/></div></section></div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.75fr)]"><Holdings/><section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">Example income</h2><HandCoins size={20} className="text-[#185da8]" /></div><p className="text-3xl font-bold tracking-tight">{precise.format(summary.dividends)}</p><p className="mt-1 text-sm text-slate-500">Synthetic dividends in this scenario</p></section></div>
  </>;
}

function Holdings() { return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-5"><h2 className="text-lg font-bold">Example holdings</h2><p className="mt-0.5 text-sm text-slate-500">These are not live prices or connected positions.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[610px] text-left"><thead className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-400"><tr><th className="pb-3">Holding</th><th className="pb-3">Shares</th><th className="pb-3">Example price</th><th className="pb-3 text-right">Example value</th></tr></thead><tbody>{demoHoldings.map((holding) => <tr key={holding.symbol} className="border-b border-slate-50 last:border-0"><td className="py-4"><p className="font-bold">{holding.symbol}</p><p className="max-w-40 truncate text-xs text-slate-500">{holding.name}</p></td><td className="py-4 text-sm font-semibold">{holding.shares}</td><td className="py-4 text-sm font-semibold">{precise.format(holding.price)}</td><td className="py-4 text-right text-sm font-bold">{precise.format(holding.shares * holding.price)}</td></tr>)}</tbody></table></div></section>; }

function ActivityPanel({ onUpload }: { onUpload: () => void }) { return <><div className="mb-8 flex items-end justify-between"><div><Pill tone="gold">Demo data</Pill><h1 className="mt-3 text-3xl font-bold tracking-tight">Example activity</h1></div><Button onClick={onUpload} className="rounded-xl bg-[#185da8] text-white"><Plus size={16}/>Preview CSV</Button></div><section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="mb-5 text-sm text-slate-500">Synthetic transactions only. A CSV preview is not saved and does not affect this example.</p><div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left"><thead className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-400"><tr><th className="pb-3">Date</th><th className="pb-3">Activity</th><th className="pb-3">Symbol</th><th className="pb-3">Details</th><th className="pb-3 text-right">Amount</th></tr></thead><tbody>{demoActivities.slice().reverse().map((item) => <tr key={item.id} className="border-b border-slate-50 last:border-0"><td className="py-4 text-sm text-slate-500">{item.date}</td><td className="py-4"><Pill tone={item.kind === 'dividend' ? 'green' : 'slate'}>{item.kind.replace('_', ' ')}</Pill></td><td className="py-4 text-sm font-bold">{item.symbol ?? '—'}</td><td className="py-4 text-sm text-slate-500">{item.description}</td><td className={`py-4 text-right text-sm font-bold ${item.amount >= 0 ? 'text-emerald-600' : ''}`}>{item.amount >= 0 ? '+' : ''}{precise.format(item.amount)}</td></tr>)}</tbody></table></div></section></>; }

function Accounts({ summary }: { summary: ReturnType<typeof calculateSummary> }) { return <><div className="mb-8"><Pill tone="gold">Demo data</Pill><h1 className="mt-3 text-3xl font-bold tracking-tight">Example account</h1></div><section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-4"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><CircleDollarSign size={23}/></span><div className="flex-1"><p className="font-bold">Example taxable brokerage</p><p className="mt-0.5 text-sm text-slate-500">Fictional account · no brokerage connected</p></div><p className="text-xl font-bold">{fmt.format(summary.value)}</p></div></section></>; }

function Documents({ onUpload, uploadError }: { onUpload: () => void; uploadError: string }) { return <><div className="mb-8"><Pill tone="gold">Local preview only</Pill><h1 className="mt-3 text-3xl font-bold tracking-tight">CSV preview</h1></div><section className="grid min-h-80 place-items-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eaf2ff] text-[#185da8]"><FileUp size={25}/></span><h2 className="mt-5 text-xl font-bold">Preview a Robinhood activity CSV</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">This early prototype reads a selected CSV in your browser only to show a temporary interpretation. It does not upload, store, or add the rows to a portfolio.</p><Button onClick={onUpload} className="mt-6 rounded-xl bg-[#185da8] text-white"><Upload size={16}/>Choose CSV</Button>{uploadError && <p role="alert" className="mx-auto mt-4 max-w-md rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{uploadError}</p>}<p className="mt-4 text-xs text-slate-400">CSV only · Up to 10 MB · Storage and secure import are not implemented yet</p></div></section></>; }

function ImportReview({ open, fileName, activities, onDiscard }: { open: boolean; fileName: string; activities: Activity[]; onDiscard: () => void }) {
  const warnings = activities.filter((activity) => activity.warning).length;
  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onDiscard(); }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-auto rounded-3xl bg-white p-6 shadow-2xl md:p-8"><DialogHeader><Pill tone="gold">Temporary browser preview</Pill><DialogTitle className="mt-3 text-2xl font-bold">Review parsed rows</DialogTitle><DialogDescription className="text-sm text-slate-500">{fileName || 'Selected CSV'} was not uploaded or saved. These rows cannot affect the demo portfolio.</DialogDescription></DialogHeader><div className="grid grid-cols-3 gap-3"><Metric label="Rows found" value={String(activities.length)}/><Metric label="Interpreted" value={String(activities.length - warnings)}/><Metric label="Needs review" value={String(warnings)}/></div>{warnings > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Some rows are not recognized. The full importer will preserve them for review instead of silently changing reports.</p>}<div className="max-h-52 overflow-auto rounded-xl border border-slate-200"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Symbol</th></tr></thead><tbody>{activities.slice(0, 20).map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3">{item.date}</td><td className="p-3">{item.kind}</td><td className="p-3">{item.symbol ?? '—'}</td></tr>)}</tbody></table></div><DialogFooter className="mt-3 rounded-b-2xl"><Button onClick={onDiscard} className="rounded-xl bg-[#185da8] text-white">Discard preview <ChevronRight size={16}/></Button></DialogFooter></DialogContent></Dialog>;
}

function Metric({ label, value, small = false }: { label: string; value: string; small?: boolean }) { return <div><p className="text-xs font-semibold text-slate-500">{label}</p><p className={`mt-1 font-bold ${small ? 'text-base' : 'text-lg'}`}>{value}</p></div>; }
