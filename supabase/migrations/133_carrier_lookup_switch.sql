-- Prompt 728, part two.
--
-- 1. carrier_lookup_live: whether an AGENT picking a carrier with no hours
--    triggers the live web lookup (carrier-hours edge function). Off until
--    Brayden has run the lookup quality check from the admin Carrier hours
--    page (admins' "Look up again" always runs the live lookup). While it's
--    off, an agent picking an unknown carrier gets Mon–Fri 9–5 ET for that
--    booking, not saved, so the carrier is still looked up once it's on.
--    The edge function's CARRIER_LOOKUP_LIVE secret stays the hard kill
--    switch for everyone.
-- 2. More carrier names, to pass the 250 the spec asked for (132 seeded 242
--    rows after merging into the existing directory).

alter table public.app_settings
  add column if not exists carrier_lookup_live boolean not null default false;

comment on column public.app_settings.carrier_lookup_live is
  'P728: agents'' carrier picks trigger the live hours lookup. Admin flips it on the Carrier hours page after the quality check.';

with seed(name, aliases) as (values
  ('SILAC', array['SILAC Insurance Company','Equitable Life & Casualty (SILAC)']),
  ('Delta Life', array['Delta Life Insurance Company']),
  ('Golden Rule', array['Golden Rule Insurance','UnitedHealthcare Life']),
  ('Humana', array['Humana Insurance Company','Humana final expense']),
  ('American Home Life', array['American Home Life Insurance Company']),
  ('Freedom Life', array['Freedom Life Insurance Company of America','USHEALTH']),
  ('National Foundation Life', array['National Foundation']),
  ('Mountain Life', array['Mountain Life Insurance Company']),
  ('Southern Security Life', array['Southern Security']),
  ('Mutual Savings Life', array['Mutual Savings']),
  ('Life of the South', array['Life of the South Insurance Company']),
  ('Philadelphia Life', array['Philadelphia Life Insurance Company']),
  ('Settlers Life', array['Settlers Life Insurance Company']),
  ('AAFMAA', array['Army and Air Force Mutual Aid Association','American Armed Forces Mutual Aid']),
  ('Liberty Union Life', array['Liberty Union Life Assurance'])
)
insert into public.carriers (name, aliases, is_active)
select s.name, s.aliases, true
  from seed s
 where not exists (
   select 1 from public.carriers c
    where lower(c.name) = lower(s.name)
       or exists (select 1 from unnest(c.aliases) a where lower(a) = lower(s.name))
 );
