-- Prompt 415: Training Center Script tab — one shared script doc, not
-- per-agent. Lands on app_settings (the existing singleton company-wide
-- settings row, migration 091) rather than a new table: the existing
-- "Everyone reads app settings" / "Admins update app settings" RLS
-- policies already give exactly the access this needs (admin-only write,
-- everyone read) with zero new policy work.
alter table app_settings
  add column if not exists training_script text,
  add column if not exists training_script_updated_at timestamptz,
  add column if not exists training_script_updated_by text;

comment on column app_settings.training_script is
  'Shared Training Center script (HTML from the admin rich-text editor in the Script tab). Single company-wide doc, not per-agent.';
comment on column app_settings.training_script_updated_by is
  'Denormalized full_name of the admin who last saved the script -- avoids a profiles join for a simple "last edited by" display.';
