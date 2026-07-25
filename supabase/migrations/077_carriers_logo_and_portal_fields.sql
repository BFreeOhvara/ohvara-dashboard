-- Prompt 331: card-grid Carrier Portals needs a logo, a core-carrier flag,
-- and the portal system's display name (subtitle under the carrier name) —
-- none of which the original migration 072 shape carried.
alter table carriers
  add column logo_url text,
  add column is_core_carrier boolean not null default false,
  add column portal_name text;
