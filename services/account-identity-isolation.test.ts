import { describe, expect, it } from 'vitest';
import { createApi } from '@/services/api/app';
import type { AccountsRepository } from '@/services/accounts/accounts';
import type { PortfolioAccount } from '@/services/accounts/accounts';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const accountTypes = ['individual', 'traditional_ira', 'roth_ira'] as const;
const sessions = new Map([
  ['session-a', userA],
  ['session-b', userB],
]);

function buildContract() {
  const accounts: PortfolioAccount[] = [];
  let nextId = 0;
  const repository: AccountsRepository = {
    list: async (userId) => accounts.filter((account) => account.userId === userId),
    get: async (userId, _accessToken, accountId) =>
      accounts.find((account) => account.id === accountId && account.userId === userId),
    create: async (userId, _accessToken, input) => {
      const account: PortfolioAccount = {
        id: `account-${++nextId}`,
        userId,
        brokerage: 'robinhood',
        accountType: input.accountType,
        name: input.name,
        currency: 'USD',
        activityCoveredThrough: null,
        createdAt: '2026-09-10T00:00:00.000Z',
      };
      accounts.push(account);
      return account;
    },
  };
  const app = createApi({
    accountsRepository: repository,
    openingHistoryRepository: { get: async () => undefined, save: async (_accountId, _userId, _accessToken, history) => history },
    verifySession: async (request) => {
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
      const userId = token ? sessions.get(token) : undefined;
      return userId ? { id: userId, accessToken: token } : undefined;
    },
  });
  return { app, accounts };
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

describe('local account identity and isolation contract', () => {
  it('lets two users create and select every supported Robinhood account type', async () => {
    const { app, accounts } = buildContract();
    for (const [token, userId] of [['session-a', userA], ['session-b', userB]] as const) {
      for (const accountType of accountTypes) {
        const response = await app.request('http://api.test/v1/accounts', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ accountType, name: `${userId.slice(0, 8)} ${accountType}` }),
        });
        expect(response.status).toBe(201);
        const account = (await readJson(response)).account as PortfolioAccount;
        expect(account).toMatchObject({ userId, accountType, brokerage: 'robinhood' });

        const selected = await app.request(`http://api.test/v1/accounts/${account.id}/opening-history`, {
          headers: { authorization: `Bearer ${token}` },
        });
        // The account is selected and ownership-checked before the optional history
        // repository is needed; the missing history dependency is the expected local result.
        expect(selected.status).toBe(200);
        expect(await readJson(selected)).toEqual({ history: null });
      }
    }
    expect(accounts).toHaveLength(6);
    expect(accounts.filter((account) => account.userId === userA)).toHaveLength(3);
    expect(accounts.filter((account) => account.userId === userB)).toHaveLength(3);
  });

  it('keeps account lists and selected-account reads private across users', async () => {
    const { app } = buildContract();
    const created = await app.request('http://api.test/v1/accounts', {
      method: 'POST',
      headers: { authorization: 'Bearer session-a', 'content-type': 'application/json' },
      body: JSON.stringify({ accountType: 'individual', name: 'User A brokerage' }),
    });
    const accountId = ((await readJson(created)).account as PortfolioAccount).id;

    const userBList = await app.request('http://api.test/v1/accounts', {
      headers: { authorization: 'Bearer session-b' },
    });
    expect(userBList.status).toBe(200);
    expect(await readJson(userBList)).toEqual({ accounts: [] });

    const guessed = await app.request(`http://api.test/v1/accounts/${accountId}/opening-history`, {
      headers: { authorization: 'Bearer session-b' },
    });
    expect(guessed.status).toBe(404);
    expect(await readJson(guessed)).toEqual({ error: 'not_found' });
  });

  it('rejects missing, invalid, and revoked sessions before private account reads', async () => {
    const { app } = buildContract();
    for (const authorization of [undefined, 'Bearer invalid-session', 'Bearer session-revoked']) {
      const headers = authorization ? { authorization } : undefined;
      const response = await app.request('http://api.test/v1/accounts', { headers });
      expect(response.status).toBe(401);
      expect(await readJson(response)).toEqual({ error: 'unauthorized' });
    }
  });
});



