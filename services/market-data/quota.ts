export type QuotaReservation = {
  reservationId: string;
  units: number;
};

export type QuotaReconciliation = {
  reservationId: string;
  reservedUnits: number;
  consumedUnits: number;
  releasedUnits: number;
};

/**
 * Durable quota boundary used by scheduled providers. Implementations must
 * reserve atomically and make reconciliation idempotent by reservation ID.
 * A reservation is made before a provider request; consumedUnits should count
 * every request that reached the provider, including an unsuccessful response.
 */
export interface MarketDataQuotaLedger {
  reserve(input: { now: Date; units: number; monthlyCap: number; idempotencyKey: string }): Promise<QuotaReservation>;
  reconcile(input: { reservationId: string; consumedUnits: number }): Promise<QuotaReconciliation>;
}

export function validateQuotaUnits(units: number, field = 'quota units'): void {
  if (!Number.isInteger(units) || units < 0) throw new Error(`${field} must be a non-negative integer.`);
}

export function validateQuotaReservationInput(input: { units: number; monthlyCap: number; idempotencyKey: string }): void {
  validateQuotaUnits(input.units);
  if (!Number.isInteger(input.monthlyCap) || input.monthlyCap < 1) throw new Error('Monthly quota cap must be a positive integer.');
  if (input.units > input.monthlyCap) throw new Error('Quota reservation exceeds the monthly cap.');
  if (!input.idempotencyKey.trim()) throw new Error('Quota reservation idempotency key is required.');
}
