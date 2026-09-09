import { describe, expect, it } from 'vitest';
import { decimalString } from '@/lib/domain/money';
import { calculateModifiedDietz, chainTimeWeightedReturn } from '@/services/calculations/returns';

const d = decimalString;

describe('Modified Dietz returns', () => {
  it('does not treat a deposit as investment profit', () => {
    expect(calculateModifiedDietz({ startingValue: d('100'), endingValue: d('200'), externalFlows: d('100'), excludedIncentives: d('0'), hasCompleteValuation: true })).toMatchObject({ investmentGain: '0', return: '0' });
  });

  it('excludes an IRA incentive from investment gain', () => {
    expect(calculateModifiedDietz({ startingValue: d('100'), endingValue: d('115'), externalFlows: d('0'), excludedIncentives: d('10'), hasCompleteValuation: true })).toMatchObject({ investmentGain: '5', return: '0.05' });
  });

  it('does not bridge unavailable return intervals', () => {
    const first = calculateModifiedDietz({ startingValue: d('100'), endingValue: d('110'), externalFlows: d('0'), excludedIncentives: d('0'), hasCompleteValuation: true });
    const missing = calculateModifiedDietz({ startingValue: d('110'), endingValue: d('115'), externalFlows: d('0'), excludedIncentives: d('0'), hasCompleteValuation: false });
    expect(chainTimeWeightedReturn([{ result: first, canChainFromPrevious: true }, { result: missing, canChainFromPrevious: true }])).toBeNull();
  });

  it('marks an invalid denominator unavailable', () => {
    expect(calculateModifiedDietz({ startingValue: d('0'), endingValue: d('0'), externalFlows: d('0'), excludedIncentives: d('0'), hasCompleteValuation: true })).toMatchObject({ return: null, unavailableReason: 'invalid_denominator' });
  });
});
