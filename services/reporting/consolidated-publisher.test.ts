import { describe, expect, it, vi } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { isoDate } from '@/lib/domain/types';
import type { PersistedReportInputs } from '@/services/reporting/compose-report-inputs';
import { publishConsolidatedReportSnapshot } from '@/services/reporting/consolidated-publisher';

const account = (id: string): { accountId: string; inputs: PersistedReportInputs } => ({
  accountId: id,
  inputs: {
    valuation: { dates: [{ date: isoDate('2026-01-05'), canChainFromPrevious: false }], events: [], openingLots: [], closes: [], corporateActions: [] },
    ledger: { cash: decimalString('10'), openLots: [], realizedGainLoss: decimalString('0'), dividendIncome: decimalString('0'), netDeposits: decimalString('10'), sales: [] },
    activityCoveredThrough: isoDate('2026-01-04'), pricesThrough: isoDate('2026-01-05'), importStateRevision: `ledger:${id}`,
  },
});

describe('consolidated report publisher', () => {
  it('publishes a null-account consolidated snapshot with deterministic revision metadata', async () => {
    const publish = vi.fn().mockResolvedValue('snapshot-1');
    await expect(publishConsolidatedReportSnapshot({ publisher: { publish }, userId: 'user-1', accounts: [account('a'), account('b')], priceRevisionId: 'price-1' as never })).resolves.toMatchObject({ snapshotId: 'snapshot-1', importStateRevision: 'consolidated:ledger:a|ledger:b', asOfDate: '2026-01-05' });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ accountId: null, reportType: 'consolidated_daily', importStateRevision: 'consolidated:ledger:a|ledger:b', priceRevisionId: 'price-1' }));
  });

  it('publishes reconciled multi-account values and income in the consolidated payload', async () => {
    const dates = [{ date: isoDate('2026-01-01'), canChainFromPrevious: false }, { date: isoDate('2026-01-02'), canChainFromPrevious: true }];
    const inputs = (accountId: string, events: PersistedReportInputs['valuation']['events']): PersistedReportInputs => ({
      valuation: {
        dates,
        events,
        openingLots: [],
        closes: [
          { instrumentId: 'instrument-1' as never, tradingDate: isoDate('2026-01-01'), close: decimalString('100'), source: 'dolthub', sourceRevision: 'r1' },
          { instrumentId: 'instrument-1' as never, tradingDate: isoDate('2026-01-02'), close: decimalString('110'), source: 'dolthub', sourceRevision: 'r1' },
        ],
        corporateActions: [],
      },
      ledger: { cash: decimalString('0'), dividendIncome: decimalString('0'), netDeposits: decimalString('0'), realizedGainLoss: decimalString('0'), sales: [], openLots: [] },
      activityCoveredThrough: isoDate('2026-01-02'), pricesThrough: isoDate('2026-01-02'), importStateRevision: `ledger:${accountId}`,
    });
    const publish = vi.fn().mockResolvedValue('snapshot-consolidated');
    const result = await publishConsolidatedReportSnapshot({
      publisher: { publish }, userId: 'user-1', priceRevisionId: null,
      accounts: [
        { accountId: 'taxable', inputs: inputs('taxable', [
          { id: 'deposit-a', date: isoDate('2026-01-01'), type: 'deposit', amount: decimalString('100') },
          { id: 'buy-a', date: isoDate('2026-01-01'), type: 'buy', instrumentId: 'instrument-1', quantity: decimalString('1'), grossAmount: decimalString('100'), fee: decimalString('0') },
          { id: 'dividend-a', date: isoDate('2026-01-02'), type: 'dividend', instrumentId: 'instrument-1', amount: decimalString('2') },
        ]) },
        { accountId: 'ira', inputs: inputs('ira', [
          { id: 'deposit-b', date: isoDate('2026-01-01'), type: 'deposit', amount: decimalString('50') },
          { id: 'buy-b', date: isoDate('2026-01-01'), type: 'buy', instrumentId: 'instrument-1', quantity: decimalString('1'), grossAmount: decimalString('50'), fee: decimalString('0') },
        ]) },
      ],
    });

    expect(result).toMatchObject({ snapshotId: 'snapshot-consolidated', importStateRevision: 'consolidated:ledger:ira|ledger:taxable', asOfDate: '2026-01-02' });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      accountId: null, reportType: 'consolidated_daily',
      payload: expect.objectContaining({
        totalValue: '222', cash: '2', netDeposits: '150', dividendIncome: '2', realizedGainLoss: '0',
        dividends: expect.arrayContaining([expect.objectContaining({ eventId: 'dividend-a', amount: '2' })]),
        valueHistory: [{ date: '2026-01-01', value: '200' }, { date: '2026-01-02', value: '222' }],
      }),
    }));
  });

  it('publishes unavailable valuations when a consolidated holding has no stored close', async () => {
    const dates = [{ date: isoDate('2026-02-02'), canChainFromPrevious: false }, { date: isoDate('2026-02-03'), canChainFromPrevious: true }];
    const publish = vi.fn().mockResolvedValue('snapshot-unavailable');
    await publishConsolidatedReportSnapshot({
      publisher: { publish }, userId: 'user-1',
      accounts: [{ accountId: 'ira', inputs: {
        valuation: {
          dates,
          events: [
            { id: 'deposit', date: isoDate('2026-02-02'), type: 'deposit', amount: decimalString('100') },
            { id: 'buy', date: isoDate('2026-02-02'), type: 'buy', instrumentId: 'instrument-missing', quantity: decimalString('1'), grossAmount: decimalString('100'), fee: decimalString('0') },
          ],
          openingLots: [], closes: [], corporateActions: [],
        },
        ledger: { cash: decimalString('0'), openLots: [], realizedGainLoss: decimalString('0'), dividendIncome: decimalString('0'), netDeposits: decimalString('0'), sales: [] },
        activityCoveredThrough: isoDate('2026-02-02'), pricesThrough: null, importStateRevision: 'ledger:ira',
      } }],
    });

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        totalValue: null,
        cash: null,
        pricesThrough: null,
        valueHistory: [{ date: '2026-02-02', value: null }, { date: '2026-02-03', value: null }],
        unavailableDates: [
          { date: '2026-02-02', reason: 'non_contiguous_period' },
          { date: '2026-02-03', reason: 'missing_valuation' },
        ],
      }),
    }));
  });
});
