import Decimal from 'decimal.js';
import { decimalString, type DecimalString } from '@/lib/domain/money';

export type ModifiedDietzInput = {
  startingValue: DecimalString;
  endingValue: DecimalString;
  externalFlows: DecimalString;
  excludedIncentives: DecimalString;
  hasCompleteValuation: boolean;
};

export type ModifiedDietzResult = {
  return: DecimalString | null;
  investmentGain: DecimalString | null;
  unavailableReason?: 'missing_valuation' | 'invalid_denominator';
};

const toDecimal = (value: DecimalString) => new Decimal(value);
const toString = (value: Decimal.Value) => decimalString(new Decimal(value).toFixed());

/** Daily Modified Dietz using the agreed midpoint approximation for external flows. */
export function calculateModifiedDietz(input: ModifiedDietzInput): ModifiedDietzResult {
  if (!input.hasCompleteValuation) return { return: null, investmentGain: null, unavailableReason: 'missing_valuation' };
  const startingValue = toDecimal(input.startingValue);
  const endingValue = toDecimal(input.endingValue);
  const externalFlows = toDecimal(input.externalFlows);
  const incentives = toDecimal(input.excludedIncentives);
  const denominator = startingValue.plus(externalFlows.times(0.5));
  if (denominator.lte(0)) return { return: null, investmentGain: null, unavailableReason: 'invalid_denominator' };
  const investmentGain = endingValue.minus(startingValue).minus(externalFlows).minus(incentives);
  return { return: toString(investmentGain.div(denominator)), investmentGain: toString(investmentGain) };
}

export type ReturnInterval = { result: ModifiedDietzResult; canChainFromPrevious: boolean };

/** Chains only a complete, contiguous set of daily return intervals. */
export function chainTimeWeightedReturn(intervals: ReturnInterval[]): DecimalString | null {
  let compound = new Decimal(1);
  for (const interval of intervals) {
    if (!interval.canChainFromPrevious || interval.result.return === null) return null;
    compound = compound.times(new Decimal(1).plus(interval.result.return));
  }
  return toString(compound.minus(1));
}
