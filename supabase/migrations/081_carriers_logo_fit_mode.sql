-- Prompt 333: some carrier logo source images have a real brand color baked
-- in as their background (Aflac's teal, Chubb/Combined's navy) and should
-- bleed edge-to-edge in the card header banner; others were composited onto
-- white and blend seamlessly with the banner as-is. logo_fit_mode drives
-- CarrierCard's object-fit choice per carrier instead of hardcoding names
-- in the component, so it keeps working as Brayden's remaining 8 logos land.
alter table carriers add column if not exists logo_fit_mode text not null default 'contain'
  check (logo_fit_mode in ('cover', 'contain'));

update carriers set logo_fit_mode = 'cover'   where name in ('Aflac', 'Chubb');
update carriers set logo_fit_mode = 'contain' where name in ('American Amicable', 'Baltimore Life');
