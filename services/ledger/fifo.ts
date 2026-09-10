import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';
import type { IsoDate } from '@/lib/domain/types';

export type LotInput = {
  id: string;
  instrumentId: string;
  acquiredOn: IsoDate | null;
  quantity: DecimalString;
  totalCostBasis: DecimalString | null;
};

export type LedgerEvent =
  | { id: string; date: IsoDate; type: 'buy' | 'drip_buy'; instrumentId: string; quantity: DecimalString; grossAmount: DecimalString; fee: DecimalString }
  | { id: string; date: IsoDate; type: 'sell'; instrumentId: string; quantity: DecimalString; grossAmount: DecimalString; fee: DecimalString }
  | { id: string; date: IsoDate; type: 'dividend' | 'interest' | 'deposit' | 'withdrawal' | 'ira_incentive' | 'transfer_in' | 'transfer_out' | 'opening_cash'; amount: DecimalString }
  | { id: string; date: IsoDate; type: 'fee'; amount: DecimalString };

export type OpenLot = LotInput & { remainingQuantity: DecimalString };

export type RealizedSale = {
  eventId: string;
  proceeds: DecimalString;
  matchedCostBasis: DecimalString | null;
  gainLoss: DecimalString | null;
  basisKnown: boolean;
};

export type LedgerResult = {
  cash: DecimalString;
  dividendIncome: DecimalString;
  netDeposits: DecimalString;
  realizedGainLoss: DecimalString | null;
  sales: RealizedSale[];
  openLots: OpenLot[];
};

const zero = () => new Decimal(0);
const asDecimal = (value: DecimalString) => new Decimal(value);
const asString = (value: Decimal.Value) => decimalString(new Decimal(value).toFixed());

function requirePositive(value: DecimalString, label: string) {
  if (asDecimal(value).lte(0)) throw new Error(`${label} must be greater than zero.`);
}

function requireNonNegative(value: DecimalString, label: string) {
  if (asDecimal(value).lt(0)) throw new Error(`${label} cannot be negative.`);
}

/**
 * Applies a normalized single-account ledger using FIFO lots. Results are for
 * analytical reporting, not tax reporting. Monetary values are exact decimals.
 */
export function applyFifoLedger(events: LedgerEvent[], openingLots: LotInput[] = []): LedgerResult {
  const openLots: OpenLot[] = openingLots.map((lot) => {
    requirePositive(lot.quantity, 'Opening lot quantity');
    if (lot.totalCostBasis !== null) requireNonNegative(lot.totalCostBasis, 'Opening lot cost basis');
    return { ...lot, remainingQuantity: lot.quantity };
  });
  let cash = zero();
  let dividendIncome = zero();
  let netDeposits = zero();
  let knownRealized = zero();
  let hasUnknownRealizedBasis = false;
  const sales: RealizedSale[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'buy':
      case 'drip_buy': {
        requirePositive(event.quantity, 'Buy quantity');
        requireNonNegative(event.grossAmount, 'Buy gross amount');
        requireNonNegative(event.fee, 'Buy fee');
        const cost = asDecimal(event.grossAmount).plus(event.fee);
        cash = cash.minus(cost);
        openLots.push({ id: event.id, instrumentId: event.instrumentId, acquiredOn: event.date, quantity: event.quantity, remainingQuantity: event.quantity, totalCostBasis: asString(cost) });
        break;
      }
      case 'sell': {
        requirePositive(event.quantity, 'Sell quantity');
        requireNonNegative(event.grossAmount, 'Sell gross amount');
        requireNonNegative(event.fee, 'Sell fee');
        const quantity = asDecimal(event.quantity);
        const proceeds = asDecimal(event.grossAmount).minus(event.fee);
        cash = cash.plus(proceeds);
        let remaining = quantity;
        let matchedBasis = zero();
        let basisKnown = true;

        for (const lot of openLots) {
          if (lot.id === event.id || lot.instrumentId !== event.instrumentId || remaining.lte(0) || lot.remainingQuantity === '0') continue;
          const lotQuantity = asDecimal(lot.remainingQuantity);
          const matched = Decimal.min(lotQuantity, remaining);
          if (lot.totalCostBasis === null) {
            basisKnown = false;
          } else {
            const originalQuantity = asDecimal(lot.quantity);
            matchedBasis = matchedBasis.plus(asDecimal(lot.totalCostBasis).times(matched).div(originalQuantity));
          }
          lot.remainingQuantity = asString(lotQuantity.minus(matched));
          remaining = remaining.minus(matched);
        }
        if (remaining.gt(0)) throw new Error(`Sell ${event.id} exceeds available lots by ${remaining.toFixed()}.`);

        const realized = basisKnown ? proceeds.minus(matchedBasis) : null;
        if (realized === null) hasUnknownRealizedBasis = true;
        else knownRealized = knownRealized.plus(realized);
        sales.push({ eventId: event.id, proceeds: asString(proceeds), matchedCostBasis: basisKnown ? asString(matchedBasis) : null, gainLoss: realized === null ? null : asString(realized), basisKnown });
        break;
      }
      case 'dividend':
        requireNonNegative(event.amount, 'Dividend amount');
        cash = cash.plus(event.amount);
        dividendIncome = dividendIncome.plus(event.amount);
        break;
      case 'interest':
        requireNonNegative(event.amount, 'Interest amount');
        cash = cash.plus(event.amount);
        break;
      case 'deposit':
        requireNonNegative(event.amount, 'Deposit amount');
        cash = cash.plus(event.amount);
        netDeposits = netDeposits.plus(event.amount);
        break;
      case 'withdrawal':
        requireNonNegative(event.amount, 'Withdrawal amount');
        cash = cash.minus(event.amount);
        netDeposits = netDeposits.minus(event.amount);
        break;
      case 'ira_incentive':
        requireNonNegative(event.amount, 'IRA incentive amount');
        cash = cash.plus(event.amount);
        break;
      case 'transfer_in':
        requireNonNegative(event.amount, 'Transfer-in amount');
        cash = cash.plus(event.amount);
        break;
      case 'transfer_out':
        requireNonNegative(event.amount, 'Transfer-out amount');
        cash = cash.minus(event.amount);
        break;
      case 'opening_cash':
        requireNonNegative(event.amount, 'Opening cash amount');
        cash = cash.plus(event.amount);
        break;
      case 'fee':
        requireNonNegative(event.amount, 'Fee amount');
        cash = cash.minus(event.amount);
        break;
    }
  }

  return {
    cash: asString(cash),
    dividendIncome: asString(dividendIncome),
    netDeposits: asString(netDeposits),
    realizedGainLoss: hasUnknownRealizedBasis ? null : asString(knownRealized),
    sales,
    openLots: openLots.filter((lot) => asDecimal(lot.remainingQuantity).gt(0)),
  };
}
