-- Where a seller's own arrangement of the sidebar lives.
--
-- Server-side rather than in the browser on purpose: someone who spends an
-- afternoon grouping fifteen menu items does not expect to do it again on the
-- laptop, and a menu that resets itself reads as a bug rather than a setting.
--
-- One jsonb column rather than tables for groups and memberships: nothing ever
-- queries inside it. The whole object is read when the shell mounts and written
-- back whole when it changes, so structure in the database would buy nothing
-- and cost a migration every time the shape moves.
CREATE TABLE IF NOT EXISTS "user_ui_prefs" (
  "user_id"    uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "nav"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
