const PLACEHOLDER_VALUES = new Set(['', 'replace-me', 'changeme', 'your-key-here', 'undefined', 'null']);

export type MarketstackDevelopmentEnvironment = {
  APP_ENV?: string;
  MARKETSTACK_API_KEY?: string;
  MARKETSTACK_MONTHLY_CAP?: string;
  MARKETSTACK_SCHEDULE_ENABLED?: string;
};

export type MarketstackDevelopmentStatus = {
  apiKeyConfigured: boolean;
  scheduleFlagEnabled: boolean;
  scheduleEnabled: boolean;
  monthlyCap: number;
  reason: string;
};

function configured(value: string | undefined): boolean {
  return value !== undefined && !PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

function explicitlyEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/**
 * Marketstack cron is opt-in. A key alone must never activate recurring calls,
 * which keeps copied development secrets from unexpectedly consuming quota.
 */
export function getMarketstackDevelopmentStatus(env: MarketstackDevelopmentEnvironment): MarketstackDevelopmentStatus {
  const apiKeyConfigured = configured(env.MARKETSTACK_API_KEY);
  const scheduleFlagEnabled = explicitlyEnabled(env.MARKETSTACK_SCHEDULE_ENABLED);
  const monthlyCap = Number(env.MARKETSTACK_MONTHLY_CAP ?? '100');
  const scheduleEnabled = apiKeyConfigured && scheduleFlagEnabled && Number.isInteger(monthlyCap) && monthlyCap > 0;
  const reason = scheduleEnabled
    ? 'Marketstack scheduled refresh is explicitly enabled.'
    : !apiKeyConfigured
      ? 'Scheduled Marketstack refresh is disabled because MARKETSTACK_API_KEY is missing.'
      : !scheduleFlagEnabled
        ? 'Scheduled Marketstack refresh is disabled until MARKETSTACK_SCHEDULE_ENABLED=true.'
        : 'Scheduled Marketstack refresh is disabled because MARKETSTACK_MONTHLY_CAP is invalid.';
  return { apiKeyConfigured, scheduleFlagEnabled, scheduleEnabled, monthlyCap, reason };
}

export function isMarketstackScheduledRefreshEnabled(env: MarketstackDevelopmentEnvironment): boolean {
  return getMarketstackDevelopmentStatus(env).scheduleEnabled;
}
