import { describe, expect, it } from 'vitest';
import { createUserDataDeletionPlan, transitionDeletionRequest } from '@/services/privacy/deletion';

describe('user data deletion', () => {
  it('requires an auditable lifecycle before a deletion can complete', () => {
    const request = { id: 'request', userId: 'user', status: 'requested' as const, requestedAt: new Date('2026-01-01T00:00:00Z'), completedAt: null };
    const processing = transitionDeletionRequest(request, 'processing', new Date('2026-01-02T00:00:00Z'));
    const complete = transitionDeletionRequest(processing, 'completed', new Date('2026-01-03T00:00:00Z'));
    expect(complete).toMatchObject({ status: 'completed', completedAt: new Date('2026-01-03T00:00:00Z') });
    expect(() => transitionDeletionRequest(complete, 'processing', new Date())).toThrow('Cannot transition');
  });

  it('collects raw files, accounts, profile, and billing cleanup without duplicate targets', () => {
    expect(createUserDataDeletionPlan('user', ['account', 'account'], ['user/statement.csv', 'user/statement.csv'], true)).toEqual({ userId: 'user', cancelBillingCustomer: true, deleteRawObjectPaths: ['user/statement.csv'], deleteAccountIds: ['account'], deleteProfile: true });
  });

  it('rejects cross-user and traversal object paths before persistence', () => {
    expect(() => createUserDataDeletionPlan('user', [], ['other-user/statement.csv'], false)).toThrow('invalid user-owned object path');
    expect(() => createUserDataDeletionPlan('user', [], ['user/../other.csv'], false)).toThrow('invalid user-owned object path');
  });

  it('preserves chronological deletion audit timestamps', () => {
    const request = { id: 'request', userId: 'user', status: 'requested' as const, requestedAt: new Date('2026-01-02T00:00:00Z'), completedAt: null };
    expect(() => transitionDeletionRequest(request, 'processing', new Date('2026-01-01T00:00:00Z'))).toThrow('cannot precede');
    expect(() => transitionDeletionRequest(request, 'processing', new Date('invalid'))).toThrow('timestamps must be valid');
  });
});
