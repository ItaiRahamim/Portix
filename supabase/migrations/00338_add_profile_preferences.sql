-- Migration: 00338_add_profile_preferences
--
-- Adds a flexible JSONB preferences column to portix.profiles.
-- Used initially to store per-importer customs-broker color tags:
--   preferences.brokerColors: { [customsAgentProfileId: UUID]: hexColor }
--
-- Future preference keys can be added without further migrations.

ALTER TABLE portix.profiles
    ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN portix.profiles.preferences IS
    'User-specific UI preferences stored as JSONB. '
    'brokerColors: { [agentId]: hexColor } for container row color tags.';
