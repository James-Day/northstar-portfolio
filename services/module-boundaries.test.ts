import { describe, expect, it } from 'vitest';
import { PORTFOLIO_MODULE_NAMES } from '@/services/module-boundaries';

describe('portfolio module boundaries', () => {
  it('exposes the seven planned composition seams', () => {
    expect(PORTFOLIO_MODULE_NAMES).toEqual([
      'identity-billing',
      'accounts',
      'ingestion',
      'ledger',
      'calculations',
      'market-data',
      'reporting',
    ]);
  });
});
