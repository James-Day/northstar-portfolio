import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#f5f7fb] px-6 py-12 text-[#13233a]">
      <article className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
        <Link href="/" className="text-sm font-bold text-[#185da8]">
          ← Northstar home
        </Link>
        <h1 className="mt-8 text-4xl font-bold tracking-tight">Terms</h1>
        <p className="mt-4 text-sm text-slate-500">
          Last updated September 11, 2026 · MVP terms
        </p>
        <div className="mt-8 space-y-7 text-base leading-7 text-slate-600">
          <section>
            <h2 className="font-bold text-slate-900">Service scope</h2>
            <p className="mt-2">
              Northstar organizes imported brokerage activity and displays
              analytical portfolio reports. It does not provide investment, tax,
              legal, or accounting advice.
            </p>
          </section>
          <section>
            <h2 className="font-bold text-slate-900">Report limitations</h2>
            <p className="mt-2">
              Returns, realized gains, and prices are analytical estimates based
              on imported activity and stored end-of-day data. Realized gains
              use FIFO for reporting and are not tax reporting. Missing or
              incomplete data remains unavailable.
            </p>
          </section>
          <section>
            <h2 className="font-bold text-slate-900">Your responsibility</h2>
            <p className="mt-2">
              Review imported rows and reports for accuracy, keep account access
              secure, and maintain your own official records. Do not upload
              files you are not authorized to share.
            </p>
          </section>
          <section>
            <h2 className="font-bold text-slate-900">
              Billing and cancellation
            </h2>
            <p className="mt-2">
              Paid plans, trial terms, and cancellation are shown at checkout
              and managed through the hosted billing portal. Cancellation does
              not remove your right to export or request deletion of your data.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
