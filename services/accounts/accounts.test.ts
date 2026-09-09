import { describe, expect, it } from 'vitest';
import { validateCreatePortfolioAccount } from '@/services/accounts/accounts';

describe('portfolio account input', () => {
  it('accepts only the Robinhood account types supported by the MVP', () => {
    expect(validateCreatePortfolioAccount({ accountType: 'roth_ira', name: '  Future me  ' })).toEqual({ accountType: 'roth_ira', name: 'Future me' });
    expect(() => validateCreatePortfolioAccount({ accountType: 'joint', name: 'Shared' })).toThrow();
  });

  it('requires a usable account name', () => {
    expect(() => validateCreatePortfolioAccount({ accountType: 'individual', name: ' ' })).toThrow('required');
    expect(() => validateCreatePortfolioAccount({ accountType: 'individual', name: 'x'.repeat(81) })).toThrow('80 characters');
  });
});
