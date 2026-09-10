import type { OpeningHistory } from '@/services/accounts/opening-history';

export interface OpeningHistoryRepository {
  get(accountId: string, userId: string, accessToken: string): Promise<OpeningHistory | undefined>;
  save(accountId: string, userId: string, accessToken: string, history: OpeningHistory): Promise<OpeningHistory>;
}
