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

export type MarketstackDevelopmentSmokeRequest = {
  symbol: string;
  tradingDate: string;
  monthlyCap: number;
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

/**
 * Validate the deliberately tiny live-smoke boundary before any provider call.
 * This keeps a development key from accidentally becoming a bulk backfill or a
 * recurring production job. It returns only safe, normalized values.
 */
export function validateMarketstackDevelopmentSmokeRequest(
  env: MarketstackDevelopmentEnvironment,
  input: { symbol?: string; tradingDate?: string; confirmedAllowance?: number },
): MarketstackDevelopmentSmokeRequest {
  if ((env.APP_ENV ?? 'development').trim().toLowerCase() === 'production') {
    throw new Error('The Marketstack development smoke fetch cannot run in production.');
  }
  if (!configured(env.MARKETSTACK_API_KEY)) throw new Error('MARKETSTACK_API_KEY is required for the development smoke fetch.');
  if (explicitlyEnabled(env.MARKETSTACK_SCHEDULE_ENABLED)) throw new Error('Disable MARKETSTACK_SCHEDULE_ENABLED before running the development smoke fetch.');
  const symbol = input.symbol?.trim().toUpperCase() ?? '';
  if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)) throw new Error('Smoke fetch requires exactly one valid symbol.');
  const tradingDate = input.tradingDate?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) throw new Error('Smoke fetch requires one trading date in YYYY-MM-DD format.');
  const parsedDate = new Date(`${tradingDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== tradingDate) throw new Error('Smoke fetch requires a valid calendar date.');
  const status = getMarketstackDevelopmentStatus(env);
  if (!Number.isInteger(status.monthlyCap) || status.monthlyCap < 1) throw new Error('MARKETSTACK_MONTHLY_CAP must be a positive integer.');
  if (input.confirmedAllowance !== undefined && (!Number.isInteger(input.confirmedAllowance) || input.confirmedAllowance < 1 || status.monthlyCap > input.confirmedAllowance)) {
    throw new Error('MARKETSTACK_MONTHLY_CAP cannot exceed the allowance confirmed for the development key.');
  }
  return { symbol, tradingDate, monthlyCap: status.monthlyCap };
}

export function isMarketstackScheduledRefreshEnabled(env: MarketstackDevelopmentEnvironment): boolean {
  return getMarketstackDevelopmentStatus(env).scheduleEnabled;
}
