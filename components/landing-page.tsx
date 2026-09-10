import {
  ArrowRight,
  Check,
  FileUp,
  LineChart,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

const benefits = [
  [
    "One clear view",
    "Track taxable and IRA accounts together without losing the details.",
    LineChart,
  ],
  [
    "Your activity, explained",
    "Import a Robinhood CSV and review every transaction before it changes your reports.",
    FileUp,
  ],
  [
    "Built for private data",
    "Secure statement storage and retention controls are planned before real imports open.",
    ShieldCheck,
  ],
];
const primary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#185da8] px-6 text-sm font-semibold text-white transition hover:bg-[#154f8e]";

export function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f5f7fb] text-[#13233a]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-bold focus:text-[#185da8] focus:shadow-lg"
      >
        Skip to content
      </a>
      <header className="relative z-10 mx-auto flex h-20 max-w-6xl items-center justify-between px-5">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-bold tracking-tight"
        >
          <BrandMark />
          <span>northstar</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex">
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="hidden text-sm font-bold text-slate-700 sm:block"
          >
            Account setup
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 rounded-xl bg-[#185da8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#154f8e]"
          >
            Explore the demo <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <section
        id="main-content"
        tabIndex={-1}
        className="relative mx-auto max-w-6xl px-5 pb-24 pt-16 text-center outline-none sm:pt-24"
      >
        <div className="pointer-events-none absolute left-1/2 top-0 -z-0 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-200/35 blur-3xl" />
        <div className="relative">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/80 px-3 py-1.5 text-sm font-semibold text-[#185da8]">
            <Sparkles size={15} />
            Prototype preview
          </p>
          <h1 className="mx-auto mt-6 max-w-4xl text-5xl font-bold tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Know how your portfolio is really doing.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Northstar is being built to turn brokerage activity into a clear
            picture of returns, dividends, realized gains, and the decisions
            behind them.
          </p>
          <div className="mt-9 flex justify-center">
            <Link href="/demo" className={primary}>
              Explore the synthetic demo <ArrowRight size={17} />
            </Link>
          </div>
          <p className="mt-4 text-sm text-slate-500">
            Accounts, storage, billing, and live market data are not connected
            yet.
          </p>
        </div>
        <div className="relative mx-auto mt-16 max-w-5xl rounded-[2rem] border border-slate-200 bg-white p-3 shadow-[0_30px_100px_rgba(23,62,111,.16)]">
          <div className="rounded-[1.45rem] bg-[#152b4a] px-5 pb-7 pt-5 text-left text-white sm:px-8">
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {[1, 2, 3].map((x) => (
                  <span
                    key={x}
                    className="h-2.5 w-2.5 rounded-full bg-white/25"
                  />
                ))}
              </div>
              <span className="text-xs font-semibold text-slate-300">
                Synthetic portfolio example
              </span>
            </div>
            <div className="mt-9 grid gap-6 sm:grid-cols-[1.3fr_.7fr]">
              <div>
                <p className="text-sm font-semibold text-slate-300">
                  Example portfolio value
                </p>
                <p className="mt-2 text-4xl font-semibold tracking-tight">
                  $15,780
                </p>
                <p className="mt-2 text-sm font-semibold text-emerald-300">
                  +14.4% in this fictional scenario
                </p>
                <div className="mt-8 flex h-20 items-end gap-2">
                  {[30, 44, 35, 59, 66, 72, 80, 88, 96].map((height, index) => (
                    <span
                      key={index}
                      className="flex-1 rounded-t bg-gradient-to-t from-sky-400/15 to-sky-300"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PreviewMetric label="Dividends" value="$24.74" />
                <PreviewMetric label="Realized" value="$37.70" />
                <PreviewMetric label="Cash" value="$2,374" />
                <PreviewMetric label="Prices" value="Not connected" />
              </div>
            </div>
          </div>
        </div>
      </section>
      <section id="how-it-works" className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-20 md:grid-cols-3">
          {benefits.map(([title, description, Icon]) => {
            const BenefitIcon = Icon as typeof LineChart;
            return (
              <article key={String(title)}>
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#eaf2ff] text-[#185da8]">
                  <BenefitIcon size={21} />
                </span>
                <h2 className="mt-5 text-xl font-bold">{String(title)}</h2>
                <p className="mt-2 text-base leading-7 text-slate-600">
                  {String(description)}
                </p>
              </article>
            );
          })}
        </div>
      </section>
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-24">
        <div className="rounded-[2rem] bg-[#152b4a] px-7 py-10 text-white sm:px-12 sm:py-12">
          <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
            <div>
              <p className="text-sm font-bold text-sky-300">Planned pricing</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                $5/month, when the service is ready.
              </h2>
              <p className="mt-3 max-w-xl text-slate-300">
                The planned annual option is $49/year. Trials and billing will
                begin only after a usable import is implemented.
              </p>
            </div>
            <Link
              href="/demo"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-[#152b4a] hover:bg-slate-100"
            >
              View demo <ArrowRight size={17} />
            </Link>
          </div>
          <div className="mt-8 grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
            {[
              "Traceable portfolio reporting",
              "Dividend and realized-gain tracking",
              "Robinhood CSV import and review",
            ].map((item) => (
              <span key={item} className="flex items-center gap-2">
                <Check size={16} className="text-emerald-300" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-slate-500">
          <span>Northstar · portfolio clarity in focus</span>
          <div className="flex gap-5 font-semibold">
            <Link href="/privacy" className="hover:text-[#185da8]">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[#185da8]">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}
