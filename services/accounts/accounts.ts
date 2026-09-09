import { z } from 'zod';
import type { AccountType } from '@/services/accounts/opening-history';

export type PortfolioAccount = {
  id: string;
  userId: string;
  brokerage: 'robinhood';
  accountType: AccountType;
  name: string;
  currency: 'USD';
  activityCoveredThrough: string | null;
  createdAt: string;
};

export type CreatePortfolioAccountInput = Pick<PortfolioAccount, 'accountType' | 'name'>;

export interface AccountsRepository {
  list(userId: string, accessToken: string): Promise<PortfolioAccount[]>;
  get(userId: string, accessToken: string, accountId: string): Promise<PortfolioAccount | undefined>;
  create(userId: string, accessToken: string, input: CreatePortfolioAccountInput): Promise<PortfolioAccount>;
}

const createAccountSchema = z.object({
  accountType: z.enum(['individual', 'traditional_ira', 'roth_ira']),
  name: z.string().trim().min(1, 'Account name is required.').max(80, 'Account name must be 80 characters or fewer.'),
});

export function validateCreatePortfolioAccount(input: unknown): CreatePortfolioAccountInput {
  return createAccountSchema.parse(input);
}
