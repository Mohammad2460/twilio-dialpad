import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client using the service role key. Never expose on the
 * client side.
 *
 * Created LAZILY on first use, not at module load: Next.js imports every route
 * module during the build's "collect page data" step, where request-time env
 * vars (SUPABASE_URL / SERVICE_ROLE_KEY) are not guaranteed present (e.g.
 * preview deploys). A module-level throw there fails the whole build. Deferring
 * creation means a missing-env error only surfaces when a request actually
 * touches the DB.
 */
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = getClient();
    const value = (c as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? value.bind(c) : value;
  },
});
