import type { DecimalString } from '@/lib/domain/money';

export type IsoDate = string & { readonly __isoDate: unique symbol };
export type InstrumentId = string & { readonly __instrumentId: unique symbol };
export type AccountId = string & { readonly __accountId: unique symbol };

export type InstrumentAlias = {
  instrumentId: InstrumentId;
  symbol: string;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
};

export type DailyClose = {
  instrumentId: InstrumentId;
  tradingDate: IsoDate;
  close: DecimalString;
  source: 'dolthub' | 'marketstack' | 'manual_correction';
  sourceRevision: string;
};

export function isoDate(value: string): IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Expected YYYY-MM-DD date, received: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date: ${value}`);
  return value as IsoDate;
}
