import { describe, expect, it, vi } from 'vitest';
import { SupabaseAccountsRepository } from '@/services/supabase/accounts-repository';

const account = { id: '4f044028-6f1d-4473-b3ee-c364f610db6c', user_id: 'c01bd705-2b93-4c33-94fc-29f6ce827cad', brokerage: 'robinhood', account_type: 'individual', name: 'Taxable', currency: 'USD', activity_covered_through: null, created_at: '2026-09-09T12:00:00.000Z' };

describe('Supabase accounts repository', () => {
  it('uses the caller token for an RLS-protected account query', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([account])));
    const repository = new SupabaseAccountsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.list(account.user_id, 'user-token')).resolves.toMatchObject([{ id: account.id, userId: account.user_id }]);
    expect(fetcher.mock.calls[0][0].pathname).toBe('/rest/v1/accounts');
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ apikey: 'anon-key', authorization: 'Bearer user-token' });
  });

  it('sends the verified user ID when creating an account', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([account])));
    const repository = new SupabaseAccountsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await repository.create(account.user_id, 'user-token', { accountType: 'individual', name: 'Taxable' });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ user_id: account.user_id, brokerage: 'robinhood', name: 'Taxable' });
  });

  it('fails closed if a database response crosses ownership boundaries', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ ...account, user_id: '95a36e89-b5aa-4799-bf88-9d17a29a97e8' }])));
    const repository = new SupabaseAccountsRepository({ supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', fetcher });

    await expect(repository.list(account.user_id, 'user-token')).rejects.toThrow('another user');
  });
});
