-- Prompt 416: lock the Training Center Script tab. Brayden has typed the
-- final script (migration 099) and wants it locked from further editing by
-- default, with an admin-only escape hatch to unlock for real revisions --
-- default true so a DB migration is never the only way back in.
alter table app_settings
  add column if not exists training_script_locked boolean not null default true;

comment on column app_settings.training_script_locked is
  'Whether the Training Center script is locked read-only. Default true; admins can unlock via the Script tab UI to make real revisions, then re-lock on save.';
