import { getMarketstackDevelopmentStatus } from '../services/platform/marketstack-development.ts';

const status = getMarketstackDevelopmentStatus({
  APP_ENV: process.env.APP_ENV,
  MARKETSTACK_API_KEY: process.env.MARKETSTACK_API_KEY,
  MARKETSTACK_MONTHLY_CAP: process.env.MARKETSTACK_MONTHLY_CAP,
  MARKETSTACK_SCHEDULE_ENABLED: process.env.MARKETSTACK_SCHEDULE_ENABLED,
});
console.log(JSON.stringify({
  ...status,
  // Keep this command safe to paste into issue logs: never print the key.
  next: status.scheduleEnabled
    ? 'Run the documented one-symbol smoke fetch, then record the database revision.'
    : 'Leave the schedule disabled until a development key and explicit opt-in are configured.',
}, null, 2));
