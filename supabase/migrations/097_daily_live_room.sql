-- Prompt 393 (superseding the Zoom-based plan from migration 091): the
-- Live Room pivots from Zoom to Daily.co — per-user Zoom Pro licensing
-- doesn't scale with a growing team, and Daily's React SDK lets the room
-- render as real in-dashboard UI instead of an iframe/new-tab link.
--
-- app_settings.zoom_room_url was never actually used (Brayden hadn't
-- provided a Zoom URL yet — confirmed null), so this is a straight rename,
-- not a data migration.
alter table app_settings rename column zoom_room_url to daily_room_url;

comment on column app_settings.daily_room_url is
  'Daily.co room URL for Team -> Meetings Live Room, e.g. https://<domain>.daily.co/<room>. Set by an admin from Settings -> Integrations. No API key stored here or anywhere client-side -- joining a Daily room only needs the room URL.';
