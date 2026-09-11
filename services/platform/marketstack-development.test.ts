import { describe, expect, it } from 'vitest';
import { getMarketstackDevelopmentStatus, isMarketstackScheduledRefreshEnabled, validateMarketstackDevelopmentSmokeRequest } from './marketstack-development';

describe('Marketstack development configuration', () => {
  it('keeps recurring refresh disabled when no key is configured', () => {
    const status = getMarketstackDevelopmentStatus({ MARKETSTACK_SCHEDULE_ENABLED: 'true' });
    expect(status.scheduleEnabled).toBe(false);
    expect(status.reason).toContain('API_KEY');
  });

  it('requires an explicit opt-in flag even when a key exists', () => {
    const status = getMarketstackDevelopmentStatus({ MARKETSTACK_API_KEY: 'dev-key' });
    expect(status.apiKeyConfigured).toBe(true);
    expect(status.scheduleFlagEnabled).toBe(false);
    expect(isMarketstackScheduledRefreshEnabled({ MARKETSTACK_API_KEY: 'dev-key' })).toBe(false);
  });

  it('enables refresh only for a configured key, true flag, and valid cap', () => {
    const status = getMarketstackDevelopmentStatus({ MARKETSTACK_API_KEY: 'dev-key', MARKETSTACK_SCHEDULE_ENABLED: 'TRUE', MARKETSTACK_MONTHLY_CAP: '100' });
    expect(status).toMatchObject({ apiKeyConfigured: true, scheduleFlagEnabled: true, scheduleEnabled: true, monthlyCap: 100 });
  });

  it('rejects placeholder keys and invalid caps without exposing configuration values', () => {
    const status = getMarketstackDevelopmentStatus({ MARKETSTACK_API_KEY: 'replace-me', MARKETSTACK_SCHEDULE_ENABLED: 'true', MARKETSTACK_MONTHLY_CAP: 'nope' });
    expect(status.scheduleEnabled).toBe(false);
    expect(status.reason).not.toContain('replace-me');
  });

  it('bounds a smoke fetch to one normalized symbol and date while the schedule is off', () => {
    expect(validateMarketstackDevelopmentSmokeRequest(
      { APP_ENV: 'development', MARKETSTACK_API_KEY: 'dev-key', MARKETSTACK_MONTHLY_CAP: '100' },
      { symbol: ' aapl ', tradingDate: '2026-09-09', confirmedAllowance: 100 },
    )).toEqual({ symbol: 'AAPL', tradingDate: '2026-09-09', monthlyCap: 100 });
  });

  it.each([
    [{ APP_ENV: 'production', MARKETSTACK_API_KEY: 'dev-key' }, { symbol: 'AAPL', tradingDate: '2026-09-09' }, 'production'],
    [{ MARKETSTACK_API_KEY: 'dev-key', MARKETSTACK_SCHEDULE_ENABLED: 'true' }, { symbol: 'AAPL', tradingDate: '2026-09-09' }, 'MARKETSTACK_SCHEDULE_ENABLED'],
    [{ MARKETSTACK_API_KEY: 'dev-key' }, { symbol: 'AAPL,MSFT', tradingDate: '2026-09-09' }, 'one valid symbol'],
    [{ MARKETSTACK_API_KEY: 'dev-key' }, { symbol: 'AAPL', tradingDate: '2026-02-30' }, 'valid calendar date'],
    [{ MARKETSTACK_API_KEY: 'dev-key', MARKETSTACK_MONTHLY_CAP: '100' }, { symbol: 'AAPL', tradingDate: '2026-09-09', confirmedAllowance: 50 }, 'allowance'],
  ])('fails closed for unsafe smoke input (%s)', (env, input, message) => {
    expect(() => validateMarketstackDevelopmentSmokeRequest(env, input)).toThrow(message);
  });
});
