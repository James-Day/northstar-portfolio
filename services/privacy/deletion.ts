export type DeletionRequestStatus = 'requested' | 'processing' | 'completed' | 'failed';

export type DeletionRequest = {
  id: string;
  userId: string;
  status: DeletionRequestStatus;
  requestedAt: Date;
  completedAt: Date | null;
};

const transitions: Record<DeletionRequestStatus, DeletionRequestStatus[]> = {
  requested: ['processing'],
  processing: ['completed', 'failed'],
  failed: ['processing'],
  completed: [],
};

export function transitionDeletionRequest(request: DeletionRequest, next: DeletionRequestStatus, at: Date): DeletionRequest {
  if (!transitions[request.status].includes(next)) throw new Error(`Cannot transition deletion request from ${request.status} to ${next}.`);
  return { ...request, status: next, completedAt: next === 'completed' ? at : null };
}

export type UserDataDeletionPlan = {
  userId: string;
  cancelBillingCustomer: boolean;
  deleteRawObjectPaths: string[];
  deleteAccountIds: string[];
  deleteProfile: boolean;
};

/** The executor must complete each durable action before marking the request complete. */
export function createUserDataDeletionPlan(userId: string, accountIds: string[], rawObjectPaths: string[], hasBillingCustomer: boolean): UserDataDeletionPlan {
  if (!userId) throw new Error('Deletion plan requires a user ID.');
  if (rawObjectPaths.some((path) => !path.startsWith(`${userId}/`) || path.includes('..') || path.includes('\\') || path.includes('\0') || path.split('/').some((part) => part.length === 0))) {
    throw new Error('Deletion plan contains an invalid user-owned object path.');
  }
  return { userId, cancelBillingCustomer: hasBillingCustomer, deleteRawObjectPaths: [...new Set(rawObjectPaths)], deleteAccountIds: [...new Set(accountIds)], deleteProfile: true };
}
