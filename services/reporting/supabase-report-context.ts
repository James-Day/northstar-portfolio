import type { QueueJob } from '@/services/queues/contracts';
import { composePersistedReportInputs, type PersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import { buildUsEquityValuationDates } from '@/services/reporting/valuation-dates';
import type { SupabaseLedgerReplayRepository } from '@/services/ledger/persisted-replay';
import type { SupabaseReportInputRepository } from '@/services/supabase/report-input-repository';
import type { ReportRecomputeContext } from '@/services/reporting/report-queue-handler';
import type { IsoDate, InstrumentId } from '@/lib/domain/types';
import type { PersistedLedgerReplay } from '@/services/ledger/persisted-replay';

type ReportJob = Extract<QueueJob, { kind: 'report.recompute' }>;

export type SupabaseReportContextLoaderOptions = {
  ledger: Pick<SupabaseLedgerReplayRepository, 'get'>;
  market: Pick<SupabaseReportInputRepository, 'listCloses' | 'listCorrections' | 'listValidatedCorporateActions' | 'findPriceRevisionId'>;
  resolveRange(job: ReportJob, replay: PersistedLedgerReplay): Promise<{ from: IsoDate; through: IsoDate }>;
  calendarOverrides?: Parameters<typeof buildUsEquityValuationDates>[0]['overrides'];
};

/** Composes one queue job from committed ledger state and validated market data. */
export function createSupabaseReportContextLoader(options: SupabaseReportContextLoaderOptions) {
  return async (job: ReportJob): Promise<ReportRecomputeContext | undefined> => {
    const replay = await options.ledger.get(job.accountId, job.requestedBy);
    if (!replay) return undefined;
    const range = await options.resolveRange(job, replay);
    const dates = buildUsEquityValuationDates({ from: range.from, through: range.through, overrides: options.calendarOverrides });
    const instrumentIds = [...new Set([
      ...replay.openingLots.map((lot) => lot.instrumentId),
      ...replay.events.flatMap((event) => 'instrumentId' in event ? [event.instrumentId] : []),
    ])] as InstrumentId[];
    const query = { instrumentIds, from: range.from, through: range.through };
    const [closes, corrections, corporateActions] = await Promise.all([
      options.market.listCloses(query),
      options.market.listCorrections(query),
      options.market.listValidatedCorporateActions(query),
    ]);
    const inputs: PersistedReportInputs = composePersistedReportInputs({ replay, dates, closes, corrections, corporateActions });
    const revisions = [...new Set((inputs.priceDependencies ?? []).map((dependency) => `${dependency.source}|${dependency.sourceRevision}`))];
    const priceRevisionId = revisions.length === 1 ? await options.market.findPriceRevisionId({ source: inputs.priceDependencies![0].source, sourceRevision: inputs.priceDependencies![0].sourceRevision }) : null;
    return { userId: job.requestedBy, accountId: job.accountId, inputs, priceRevisionId };
  };
}
