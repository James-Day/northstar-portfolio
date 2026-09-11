/** Durable, ordered execution of a persisted user deletion plan. */
export type DeletionTargetType = 'raw_object' | 'account' | 'report_snapshots' | 'profile' | 'billing_customer' | 'auth_user';

export type DeletionPlanItem = {
  id: string;
  requestId: string;
  userId: string;
  targetType: DeletionTargetType;
  targetId: string | null;
  targetPath: string | null;
  attempt: number;
};

export type DeletionPlanRepository = {
  claim(limit: number, now: Date, maxAttempts: number): Promise<DeletionPlanItem[]>;
  /** The attempt fences completion against a stale worker that lost its lease. */
  complete(id: string, at: Date, attempt?: number): Promise<void>;
  fail(id: string, input: { failedAt: Date; retryAt: Date; error: string; maxAttempts: number; attempt?: number }): Promise<'retrying' | 'exhausted' | 'ignored'>;
};

export type DeletionSideEffects = {
  deletePrivateObject(path: string): Promise<void>;
  deleteAccount(userId: string, accountId: string): Promise<void>;
  deleteReportSnapshots(userId: string): Promise<void>;
  deleteProfile(userId: string): Promise<void>;
  cancelBillingCustomer(userId: string, customerId: string | null): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
};

export type DeletionRunResult = { claimed: number; completed: number; retrying: number; exhausted: number };

// Dependencies must be removed before profile/auth rows. This ordering also
// prevents a retry from using a user record already removed by auth.
const priority: Record<DeletionTargetType, number> = {
  raw_object: 10,
  account: 20,
  report_snapshots: 30,
  billing_customer: 40,
  profile: 50,
  auth_user: 60,
};

function retryAt(now: Date, attempt: number): Date {
  const delay = Math.min(60 * 60 * 1000, 5_000 * 2 ** Math.max(0, attempt - 1));
  return new Date(now.getTime() + delay);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}

async function executeItem(item: DeletionPlanItem, effects: DeletionSideEffects): Promise<void> {
  switch (item.targetType) {
    case 'raw_object':
      if (!item.targetPath) throw new Error('Deletion raw-object item has no object path.');
      if (!isOwnedObjectPath(item.userId, item.targetPath)) throw new Error('Deletion raw-object item has an invalid user-owned path.');
      return effects.deletePrivateObject(item.targetPath);
    case 'account':
      if (!item.targetId) throw new Error('Deletion account item has no account ID.');
      return effects.deleteAccount(item.userId, item.targetId);
    case 'report_snapshots':
      return effects.deleteReportSnapshots(item.userId);
    case 'billing_customer':
      return effects.cancelBillingCustomer(item.userId, item.targetId);
    case 'profile':
      return effects.deleteProfile(item.userId);
    case 'auth_user':
      return effects.deleteAuthUser(item.userId);
  }
}

function isOwnedObjectPath(userId: string, path: string): boolean {
  const normalizedUserId = userId.trim();
  return Boolean(normalizedUserId) && path.startsWith(`${normalizedUserId}/`) && !path.includes('..') && !path.includes('\\') && !path.includes('\0');
}

export async function runUserDeletion(input: {
  repository: DeletionPlanRepository;
  effects: DeletionSideEffects;
  limit?: number;
  maxAttempts?: number;
  now?: () => Date;
}): Promise<DeletionRunResult> {
  const now = input.now ?? (() => new Date());
  const current = now();
  const maxAttempts = input.maxAttempts ?? 8;
  const items = (await input.repository.claim(input.limit ?? 25, current, maxAttempts)).sort((a, b) => priority[a.targetType] - priority[b.targetType]);
  const result: DeletionRunResult = { claimed: items.length, completed: 0, retrying: 0, exhausted: 0 };
  for (const item of items) {
    try {
      await executeItem(item, input.effects);
      await input.repository.complete(item.id, now(), item.attempt);
      result.completed += 1;
    } catch (error) {
      const outcome = await input.repository.fail(item.id, { failedAt: now(), retryAt: retryAt(current, item.attempt), error: errorMessage(error), maxAttempts, attempt: item.attempt });
      if (outcome === 'exhausted') result.exhausted += 1;
      else if (outcome === 'retrying') result.retrying += 1;
    }
  }
  return result;
}
