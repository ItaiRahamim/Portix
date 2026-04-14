/**
 * Portix — Supabase Admin Client (Service Role)
 * Use ONLY in server-side code: Route Handlers, Server Actions.
 * Never import this in Client Components — it exposes the service role key.
 */

import { createClient } from "@supabase/supabase-js";

export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  return createClient(url, key, {
    db: { schema: "portix" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
