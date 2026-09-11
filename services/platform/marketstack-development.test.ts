import { describe, expect, it } from 'vitest';
import { getMarketstackDevelopmentStatus, isMarketstackScheduledRefreshEnabled } from './marketstack-development';

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
});
