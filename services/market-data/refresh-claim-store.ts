import type { RefreshClaimStore } from '@/services/market-data/scheduled-refresh';

/** Deterministic single-process claim store for local runs and tests. */
export class MemoryRefreshClaimStore implements RefreshClaimStore {
  private readonly claims = new Set<string>();
  async tryClaim(key: string): Promise<boolean> { if (this.claims.has(key)) return false; this.claims.add(key); return true; }
  async release(key: string): Promise<void> { this.claims.delete(key); }
}
