-- Migration: 00345_restore_view_grants
--
-- 00344 dropped + recreated v_containers, v_documents_public, and
-- v_import_licenses to switch them to security_invoker=true. DROP VIEW
-- discards all object-level privileges, and 00344 did not re-grant.
-- Result: PostgREST queries from `authenticated` users hit
--   "permission denied for view v_documents_public"
-- which surfaces as an empty document checklist on the container page
-- (and similar empties for container lists + licenses).
--
-- Restore the SELECT grants that 00329 / 00333 originally established.
-- service_role keeps full access from migration 00342.

GRANT SELECT ON portix.v_containers       TO authenticated, anon;
GRANT SELECT ON portix.v_documents_public TO authenticated, anon;
GRANT SELECT ON portix.v_import_licenses  TO authenticated, anon;

-- Ensure PostgREST reloads its schema cache so the new grants take effect
-- without waiting for the next autorefresh.
NOTIFY pgrst, 'reload schema';
