import { describe, expect, it, vi } from 'vitest';
import { SupabaseDeletionEffects } from './deletion-effects';

describe('SupabaseDeletionEffects', () => {
  it('uses the restricted account cleanup RPC and authenticated endpoints', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const effects = new SupabaseDeletionEffects({ supabaseUrl: 'https://db.test', serviceRoleKey: 'service-secret', fetcher, cancelBillingCustomer: vi.fn().mockResolvedValue(undefined) });
    await effects.deleteAccount('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
    await effects.deleteReportSnapshots('11111111-1111-4111-8111-111111111111');
    await effects.deleteAuthUser('11111111-1111-4111-8111-111111111111');
    expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/delete_user_account_data');
    expect(String(fetcher.mock.calls[1][0])).toContain('/report_snapshots?user_id=eq.11111111-1111-4111-8111-111111111111');
    expect(String(fetcher.mock.calls[2][0])).toContain('/auth/v1/admin/users/11111111-1111-4111-8111-111111111111');
  });

  it('requires a service role and delegates billing cancellation', async () => {
    await expect(() => new SupabaseDeletionEffects({ supabaseUrl: 'https://db.test', serviceRoleKey: ' ', cancelBillingCustomer: vi.fn() })).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    const cancel = vi.fn().mockResolvedValue(undefined);
    const effects = new SupabaseDeletionEffects({ supabaseUrl: 'https://db.test', serviceRoleKey: 'secret', cancelBillingCustomer: cancel });
    await effects.cancelBillingCustomer('user', 'cus_123');
    expect(cancel).toHaveBeenCalledWith('user', 'cus_123');
  });
});
