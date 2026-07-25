-- Prompt 335: per-carrier logo size tuning ("make X a little bigger/smaller")
-- is now a data change instead of a new component-code round each time.
-- Applied as transform: scale(logo_zoom_pct / 100) layered on top of
-- whichever object-fit the carrier already uses.
alter table carriers add column if not exists logo_zoom_pct integer not null default 100;

update carriers set logo_zoom_pct = 135 where name = 'F&G';
update carriers set logo_zoom_pct = 135 where name = 'Fidelity Life';
update carriers set logo_zoom_pct = 110 where name = 'Corebridge';
update carriers set logo_zoom_pct = 85  where name = 'Foresters';
