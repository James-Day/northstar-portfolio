import type { DecimalString } from '@/lib/domain/money';
import type { IsoDate } from '@/lib/domain/types';

export type DailyPrice = {
  symbol: string;
  tradingDate: IsoDate;
  close: DecimalString;
  provider: 'marketstack';
  providerMetadata: Record<string, string | number | boolean | null>;
};

export interface DailyPriceProvider {
  getDailyPrices(symbols: string[], date: IsoDate): Promise<DailyPrice[]>;
}

export interface PriceRequestBudget {
  reserve(units: number): void;
}
