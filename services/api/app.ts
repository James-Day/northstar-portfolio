import { Hono } from 'hono';

/**
 * The standalone API shell. It is intentionally not mounted into the prototype
 * site until Supabase authentication and durable storage are configured.
 */
export const api = new Hono();

api.get('/health', (context) => context.json({ status: 'ok', service: 'northstar-api' }));
