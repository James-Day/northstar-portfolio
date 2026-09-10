import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f5f7fb] px-6 py-12 text-[#13233a]">
      <article className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
        <Link href="/" className="text-sm font-bold text-[#185da8]">
          ← Northstar home
        </Link>
        <h1 className="mt-8 text-4xl font-bold tracking-tight">Privacy</h1>
        <p className="mt-4 text-sm text-slate-500">
          Last updated September 11, 2026 · MVP policy
        </p>
        <div className="mt-8 space-y-7 text-base leading-7 text-slate-600">
          <section>
            <h2 className="font-bold text-slate-900">What we store</h2>
            <p className="mt-2">
              When connected, Northstar stores your account profile, normalized
              brokerage activity, derived portfolio reports, and private
              statement files needed to provide the service.
            </p>
          </section>
          <section>
            <h2 className="font-bold text-slate-900">Statement retention</h2>
            <p className="mt-2">
              Raw brokerage files are private and scheduled for deletion after
              30 days. Normalized activity and reports remain until you delete
              your account or request removal.
            </p>
          </section>
          <section>
            <h2 className="font-bold text-slate-900">Your controls</h2>
            <p className="mt-2">
              Settings provides account-scoped activity and report exports,
              billing management, and an account deletion request. We do not
              sell brokerage data or use it for investment recommendations.
            </p>
          </section>
          <section>
            <h2 className="font-bold text-slate-900">Service providers</h2>
            <p className="mt-2">
              Supabase provides authentication, database, and private storage.
              Stripe handles billing. Market-data providers supply end-of-day
              prices. Provider credentials stay on the server.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
