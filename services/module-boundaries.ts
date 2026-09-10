import type { Entitlement } from '@/services/billing/entitlements';
import type { AccountsRepository, PortfolioAccount } from '@/services/accounts/accounts';
import type { ValuationHistory } from '@/services/calculations/valuation';
import type { StagedRobinhoodImport } from '@/services/ingestion/staging';
import type { LedgerEvent, LedgerResult, LotInput } from '@/services/ledger/fifo';
import type { DailyPriceProvider } from '@/services/market-data/types';
import type { ReportSnapshotPayload } from '@/services/reporting/snapshot-builder';

/** Stable application seams. Adapters may change without crossing these ports. */
export type IdentityBillingModule = {
  getEntitlement(userId: string): Promise<Entitlement>;
};

export type AccountsModule = Pick<AccountsRepository, 'list' | 'get' | 'create'>;

export type IngestionModule = {
  stageRobinhood(accountId: string, csv: string): Promise<StagedRobinhoodImport>;
};

export type LedgerModule = {
  apply(events: LedgerEvent[], openingLots?: LotInput[]): LedgerResult;
};

export type CalculationsModule = {
  value(input: Parameters<typeof import('@/services/calculations/valuation').valueLedgerHistory>[0]): ValuationHistory;
};

export type MarketDataModule = Pick<DailyPriceProvider, 'getDailyPrices'>;

export type ReportingModule = {
  buildSnapshot(input: Parameters<typeof import('@/services/reporting/snapshot-builder').buildReportSnapshotPayload>[0]): ReportSnapshotPayload;
};

/** The composition root depends on these ports; domain modules do not depend on UI or storage adapters. */
export type PortfolioModulePorts = {
  identityBilling: IdentityBillingModule;
  accounts: AccountsModule;
  ingestion: IngestionModule;
  ledger: LedgerModule;
  calculations: CalculationsModule;
  marketData: MarketDataModule;
  reporting: ReportingModule;
};

export const PORTFOLIO_MODULE_NAMES = [
  'identity-billing',
  'accounts',
  'ingestion',
  'ledger',
  'calculations',
  'market-data',
  'reporting',
] as const;

// Keep this import in the public contract so account implementations cannot
// silently drift from the persisted account shape.
export type AccountRecord = PortfolioAccount;
