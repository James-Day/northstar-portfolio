'use client';

import { useMemo, useState } from 'react';
import { analyzeDividends, type DividendEventInput, type DividendPeriod } from '@/services/reporting/dividend-analysis';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const month = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function DividendsPanel({ events, isLiveAccount, asOfDate }: { events?: DividendEventInput[]; isLiveAccount: boolean; asOfDate?: string }) {
  const [view, setView] = useState<'monthly' | 'yearly' | 'daily' | 'projected'>('monthly');
  const demoEvents = useMemo<DividendEventInput[]>(() => [
    { eventId: 'demo-vti-1', date: '2025-01-15', instrumentId: 'VTI', amount: '18.92' },
    { eventId: 'demo-msft-1', date: '2025-04-01', instrumentId: 'MSFT', amount: '5.82' },
    { eventId: 'demo-vti-2', date: '2025-04-15', instrumentId: 'VTI', amount: '19.10' },
  ], []);
  const source = events ?? (isLiveAccount ? [] : demoEvents);
  const analysis = useMemo(() => analyzeDividends(source, asOfDate), [source, asOfDate]);
  const rows = view === 'monthly' ? analysis.monthly : view === 'yearly' ? analysis.yearly : view === 'daily' ? analysis.daily : analysis.projectedMonthly;
  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${isLiveAccount ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-400/15 text-amber-800'}`}>
            {isLiveAccount ? 'Imported income' : 'Demo data'}
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Dividends</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Review cash income by day, month, or year, with a clearly labeled estimate of future payments.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-right shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total received</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{currency.format(Number(analysis.total))}</p>
        </div>
      </div>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-4" role="tablist" aria-label="Dividend views">
          {([
            ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['daily', 'Day by day'], ['projected', 'Projected'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === value ? 'bg-[#eaf2ff] text-[#185da8]' : 'text-slate-500 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        {view === 'projected' && (
          <p className="mt-4 rounded-xl bg-sky-50 p-3 text-sm leading-6 text-sky-900">
            Projection repeats each holding’s average historical payment using its average payment interval. It is an estimate, does not use Marketstack, and cannot know whether a company changes or skips a dividend.
          </p>
        )}
        {!isLiveAccount && <p className="mt-4 text-xs text-slate-400">Synthetic example data is shown here so you can explore the feature.</p>}
        {isLiveAccount && !events && <p className="mt-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Dividend details will appear after a report is published.</p>}
        {rows.length === 0 && (events || !isLiveAccount) && <p className="mt-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">{view === 'projected' ? 'At least two payments for the same holding are needed before a projection can be estimated.' : 'No dividend payments in this view.'}</p>}
        {rows.length > 0 && <DividendTable rows={rows} projected={view === 'projected'} />}
      </section>
    </div>
  );
}

function DividendTable({ rows, projected }: { rows: DividendPeriod[]; projected: boolean }) {
  return <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[440px] text-left"><caption className="sr-only">{projected ? 'Projected dividend payments' : 'Dividend payments'}</caption><thead className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-400"><tr><th scope="col" className="pb-3">{projected ? 'Expected month' : 'Period'}</th><th scope="col" className="pb-3 text-right">Payments</th><th scope="col" className="pb-3 text-right">Amount</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.period}-${projected ? 'projected' : 'actual'}`} className="border-b border-slate-50 last:border-0"><td className="py-3 text-sm font-semibold">{projected ? month.format(new Date(`${row.period}-01T00:00:00Z`)) : row.period}</td><td className="py-3 text-right text-sm text-slate-500">{row.eventCount}</td><td className={`py-3 text-right text-sm font-bold ${projected ? 'text-sky-700' : 'text-emerald-600'}`}>{currency.format(Number(row.amount))}</td></tr>)}</tbody></table></div>;
}
