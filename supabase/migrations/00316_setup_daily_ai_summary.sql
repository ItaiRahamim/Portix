-- ============================================================
-- Migration 00316 — Daily AI Claim Summary (Gemini + pg_cron)
-- ============================================================
-- What this does:
--   1. Adds last_summary_at column to portix.claims
--   2. Enables pg_cron and pg_net extensions
--   3. Creates portix.run_daily_claim_summaries() — reads the service role
--      key from Supabase Vault (no ALTER DATABASE required) and fires one
--      HTTP POST to the generate-claim-summary Edge Function in bulk mode.
--   4. Schedules the function to run daily at 23:00 UTC via pg_cron.
--
-- ─── One-time setup (run ONCE in SQL Editor before this migration) ────────────
--
-- Step 1 — Store your service role key in Vault (never expose it in code):
--
--   SELECT vault.create_secret(
--     'YOUR_SERVICE_ROLE_KEY',   -- paste your actual key here
--     'service_role_key',        -- the secret name the function will look up
--     'Portix: service role key for Edge Function invocations'
--   );
--
-- Step 2 — Store your Supabase project URL in Vault:
--
--   SELECT vault.create_secret(
--     'https://YOUR_PROJECT_REF.supabase.co',  -- e.g. https://abcdefgh.supabase.co
--     'supabase_project_url',
--     'Portix: base URL for this Supabase project'
--   );
--
-- Your service role key → Dashboard → Settings → API → service_role (secret).
-- Your project URL      → Dashboard → Settings → API → Project URL.
--
-- To verify secrets were stored correctly (decrypted values shown):
--   SELECT name, decrypted_secret FROM vault.decrypted_secrets
--   WHERE name IN ('service_role_key', 'supabase_project_url');
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Add last_summary_at to portix.claims ─────────────────────────────────

ALTER TABLE portix.claims
  ADD COLUMN IF NOT EXISTS last_summary_at TIMESTAMPTZ DEFAULT NULL;

-- ─── 2. Enable extensions ─────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron  WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;
-- supabase_vault is enabled by default on Supabase — listed here for clarity.
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ─── 3. Helper function: portix.run_daily_claim_summaries() ──────────────────
-- Reads credentials from Supabase Vault (never from GUCs or hardcoded values).
-- Fires a single async HTTP POST to the Edge Function in bulk mode.

CREATE OR REPLACE FUNCTION portix.run_daily_claim_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- Restrict search_path so no rogue schema can shadow vault or extensions
SET search_path = portix, vault, extensions, pg_temp
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_fn  TEXT;
BEGIN
  -- ── Read credentials from Supabase Vault ──────────────────────────────────
  -- vault.decrypted_secrets decrypts on-the-fly using the Vault master key.
  -- If a secret is missing, the SELECT returns NULL (no exception).

  SELECT decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets
   WHERE name = 'supabase_project_url'
   LIMIT 1;

  SELECT decrypted_secret
    INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;

  -- ── Guard: abort with a clear log if secrets are missing ─────────────────
  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING '[portix] Vault secret "supabase_project_url" is not set. '
      'Run: SELECT vault.create_secret(''https://YOUR_PROJECT_REF.supabase.co'', ''supabase_project_url'', '''');';
    RETURN;
  END IF;

  IF v_key IS NULL OR v_key = '' THEN
    RAISE WARNING '[portix] Vault secret "service_role_key" is not set. '
      'Run: SELECT vault.create_secret(''YOUR_SERVICE_ROLE_KEY'', ''service_role_key'', '''');';
    RETURN;
  END IF;

  -- ── Build Edge Function URL ───────────────────────────────────────────────
  v_fn := rtrim(v_url, '/') || '/functions/v1/generate-claim-summary';

  -- ── Fire async HTTP POST via pg_net ──────────────────────────────────────
  -- pg_net is non-blocking: this returns immediately with a request ID.
  -- The Edge Function runs asynchronously, processes all non-closed claims,
  -- calls Gemini for each with new activity, and writes claim_summary +
  -- last_summary_at back to portix.claims.
  PERFORM extensions.http_post(
    url     := v_fn,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{"bulk": true}'
  );

  RAISE LOG '[portix] Triggered generate-claim-summary at % (bulk mode)', v_fn;
END;
$$;

-- ─── 4. pg_cron job: daily at 23:00 UTC ──────────────────────────────────────
-- Idempotent: unschedule any existing job with this name before re-creating.

SELECT cron.unschedule('daily-claim-summaries') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-claim-summaries'
);

SELECT cron.schedule(
  'daily-claim-summaries',           -- unique job name
  '0 23 * * *',                      -- 23:00 UTC every day
  $$SELECT portix.run_daily_claim_summaries()$$
);

-- ─── Verification ─────────────────────────────────────────────────────────────
-- After running this migration:
--
--   -- Confirm cron job registered:
--   SELECT jobid, jobname, schedule, command FROM cron.job
--   WHERE jobname = 'daily-claim-summaries';
--
--   -- Confirm column added:
--   SELECT id, last_summary_at FROM portix.claims LIMIT 3;
--
--   -- Test immediately (processes all active claims right now):
--   SELECT portix.run_daily_claim_summaries();
--
--   -- Check pg_net async request log:
--   SELECT * FROM extensions.http_request_queue ORDER BY created DESC LIMIT 5;
