-- Prompt 728 — Book a call: carrier search with live suggestions, and the
-- carrier's open hours set the bookable times.
--
-- The Fulfillment call is a 3-way call with the carrier the client is
-- leaving, so a slot is only bookable while that carrier's policyholder line
-- is open. Hours live on the existing `carriers` table (no second carrier
-- table). They are filled lazily: the 20 researched carriers are seeded
-- here (vault: brain/carrier-hours.md), everything else is looked up once by
-- the `carrier-hours` edge function and cached for 180 days.
--
-- hours: { "mon": { "open": "08:30", "close": "16:30" } | null, ... "sun" }
--        in the carrier's own zone, hours_tz (US IANA zones only).
-- hours_status: verified  = read on the carrier's own page (or fixed by an admin)
--               ai        = found by the live lookup (or a third-party source)
--               fallback  = lookup failed; Mon–Fri 9–5 ET stands in
--               pending   = added by an agent, not looked up yet
--               null      = seeded name, never looked up
-- hours_lookup_at: claim stamp so two agents picking the same new carrier
--               trigger one lookup (the edge function clears it when done).
-- sort_rank:    how common the carrier is (lower = shown first among equal
--               matches). Top 20 by 2025 LIMRA individual life sales, then
--               the carriers agents here already book against.

alter table public.carriers
  add column if not exists aliases text[] not null default '{}',
  add column if not exists service_phone text,
  add column if not exists hours jsonb,
  add column if not exists hours_tz text,
  add column if not exists hours_source_url text,
  add column if not exists hours_status text,
  add column if not exists hours_checked_at timestamptz,
  add column if not exists hours_lookup_at timestamptz,
  add column if not exists sort_rank integer;

alter table public.carriers drop constraint if exists carriers_hours_status_check;
alter table public.carriers add constraint carriers_hours_status_check
  check (hours_status is null or hours_status in ('verified', 'ai', 'fallback', 'pending'));

-- policies.carrier_id already exists (migration 072, FK on delete set null).
-- From P728 a booking points it at the carrier whose hours it used.
alter table public.policies
  add column if not exists carrier_id uuid references public.carriers(id) on delete set null;

-- ── Seed: US life insurers by the name an agent or client would say ─────────
-- Names only (hours fill in lazily). Existing rows are merged into by name,
-- never duplicated; their aliases are unioned.
with seed(name, aliases) as (values
  ('AAA Life', array['AAA Life Insurance','Auto Club Life']),
  ('Aetna', array['Aetna final expense','Aetna Senior Supplemental','CVS Health','Continental Life Insurance Company of Brentwood','American Continental Insurance','Accendo Insurance','Loyal American Life','American Retirement Life']),
  ('Aflac', array['American Family Life Assurance','Aflac Life']),
  ('Alfa Life', array['Alfa Insurance']),
  ('Allianz Life', array['Allianz','Allianz Life Insurance Company of North America']),
  ('Allstate', array['Allstate Life','Allstate Assurance','Allstate Benefits']),
  ('American Amicable', array['American-Amicable','American Amicable Life','Occidental Life of America','Iowa American Life','Pioneer American']),
  ('American Equity', array['American Equity Investment Life','Eagle Life']),
  ('American Family Life', array['American Family Insurance','AmFam','AmFam Life']),
  ('American Fidelity', array['American Fidelity Assurance']),
  ('American Heritage Life', array['American Heritage']),
  ('American Income Life', array['AIL','American Income']),
  ('American Memorial Life', array['American Memorial','AMLIC']),
  ('American National', array['American National Insurance','ANICO','Garden State Life']),
  ('American Public Life', array['APL']),
  ('Americo', array['Americo Financial Life','Great Southern Life','United Fidelity Life']),
  ('Ameritas', array['Ameritas Life','Acacia Life','Union Central Life']),
  ('Amica Life', array['Amica']),
  ('Armed Forces Benefit Association', array['AFBA','5Star Life','5 Star Life']),
  ('Aspida', array['Aspida Life']),
  ('Assurant', array['Union Security Insurance','Union Security Life']),
  ('Assurity', array['Assurity Life']),
  ('Athene', array['Athene Annuity and Life','Presidential Life','Aviva Life']),
  ('Auto-Owners Life', array['Auto-Owners','Auto Owners Life']),
  ('Baltimore Life', array['The Baltimore Life','Baltimore Life Companies']),
  ('Banner Life', array['Legal & General America','Legal and General America','LGA','Legal & General']),
  ('Bankers Fidelity', array['Bankers Fidelity Life','Atlantic American']),
  ('Bankers Life', array['Bankers Life and Casualty','Conseco','CNO Financial']),
  ('Bankers Life of Louisiana', array['Bankers Life Insurance Company of Louisiana']),
  ('Berkshire Hathaway Life', array['Berkshire Hathaway Life Insurance Company of Nebraska']),
  ('Bestow', array['Bestow Life']),
  ('Boston Mutual', array['Boston Mutual Life']),
  ('Brighthouse Financial', array['Brighthouse','Brighthouse Life','New England Life','NELICO','MetLife Investors']),
  ('Canada Life', array['Great-West Life','Great-West Financial','Empower']),
  ('Catholic Financial Life', array['Catholic Knights']),
  ('Catholic Life Insurance', array['Catholic Life']),
  ('Catholic Order of Foresters', array['COF']),
  ('Chubb', array['Chubb Life','Federal Insurance (Chubb)']),
  ('CICA Life', array['Citizens Inc','Citizens Insurance Company of America','Security Plan Life']),
  ('Cigna', array['Cigna Life','Cigna Health and Life']),
  ('Cincinnati Life', array['Cincinnati Financial','Cincinnati Insurance']),
  ('Citizens Security Life', array['Citizens Security Group']),
  ('Clear Spring Life', array['Clear Spring Life and Annuity']),
  ('Colonial Life', array['Colonial Life & Accident','Colonial Life and Accident']),
  ('Colonial Penn', array['Colonial Penn Life','Colonial Penn Life Insurance']),
  ('Colorado Bankers Life', array['CBL']),
  ('Columbian Mutual', array['Columbian Financial Group','Columbian Life','Columbian']),
  ('Columbus Life', array['Columbus Life Insurance']),
  ('Combined Insurance', array['Combined Insurance Company of America','Combined']),
  ('Corebridge', array['SunAmerica','VALIC','Corebridge Financial','AIG','American General','American General Life','AGL','AIG Life & Retirement','United States Life','USL','AIG Direct']),
  ('COUNTRY Financial', array['COUNTRY Life','COUNTRY Investors Life','Cotton States Life']),
  ('CSA Fraternal Life', array['CSA']),
  ('Dayforward', array['Dayforward Life']),
  ('Dearborn Life', array['Dearborn National','Dearborn Group','Fort Dearborn Life']),
  ('Delaware Life', array['Delaware Life Insurance']),
  ('Elco Mutual', array['ELCO Mutual Life','Elco']),
  ('Equitable', array['AXA Equitable','Equitable Financial','Equitable Holdings','MONY America']),
  ('EquiTrust Life', array['EquiTrust']),
  ('Erie Family Life', array['Erie Insurance','Erie Life']),
  ('Ethos', array['Ethos Life']),
  ('Everence', array['Everence Financial','Mennonite Mutual Aid']),
  ('Everlake Life', array['Everlake']),
  ('F&G', array['OM Financial','Fidelity & Guaranty Life','Fidelity and Guaranty','FGL','F and G']),
  ('Family Heritage Life', array['Family Heritage']),
  ('Farm Bureau Life', array['Farm Bureau Financial Services','FBL Financial','Farm Bureau']),
  ('Farmers & Traders Life', array['Farmers and Traders Life']),
  ('Farmers New World Life', array['Farmers Insurance','Farmers Life','Farmers']),
  ('Federal Life', array['Federal Life Insurance Company']),
  ('Fidelity Investments Life', array['Fidelity Investments','Empire Fidelity Investments Life']),
  ('Fidelity Life', array['Fidelity Life Association','RAPIDecision']),
  ('Fidelity Security Life', array['FSL']),
  ('Foresters', array['Foresters Financial','Independent Order of Foresters','First Investors Life']),
  ('Funeral Directors Life', array['FDLIC','Funeral Directors Life Insurance Company']),
  ('Gainbridge', array['Gainbridge Life','Group 1001']),
  ('GBU Financial Life', array['GBU Life','GBU']),
  ('Genworth', array['Genworth Life','GE Capital Life','First Colony Life']),
  ('Gerber Life', array['Fabric','Gerber','Gerber Life Insurance']),
  ('Gleaner Life', array['Gleaner']),
  ('Global Atlantic', array['Global Atlantic Financial Group','Forethought Life','Forethought','Accordia Life','Commonwealth Annuity','First Allmerica']),
  ('Globe Life', array['Globe Life and Accident','Torchmark']),
  ('Government Personnel Mutual', array['GPM Life','GPM']),
  ('Grange Life', array['Grange Insurance']),
  ('Great Western', array['Great Western Insurance','Great Western Life']),
  ('Guarantee Trust Life', array['GTL','Guarantee Trust']),
  ('Guardian Life', array['Guardian','The Guardian Life Insurance Company of America','Berkshire Life']),
  ('Haven Life', array['Haven']),
  ('Homesteaders Life', array['Homesteaders']),
  ('Horace Mann', array['Horace Mann Life']),
  ('Illinois Mutual', array['Illinois Mutual Life']),
  ('Individual Assurance Company', array['IAC']),
  ('Integrity Life', array['Integrity Life Insurance']),
  ('Investors Heritage', array['Investors Heritage Life','Kentucky Investors']),
  ('Jackson National', array['Jackson','Jackson National Life','Jackson Financial']),
  ('John Hancock', array['John Hancock Life','Manulife','JH']),
  ('Kansas City Life', array['KCL','Old American Insurance','Sunset Life']),
  ('Kemper Life', array['Kemper','Reserve National','United Insurance Company of America','Kemper Home Service','Reliable Life Insurance']),
  ('Knights of Columbus', array['K of C','KofC']),
  ('Kuvare', array['Guaranty Income Life','United Life']),
  ('Ladder Life', array['Ladder']),
  ('Lafayette Life', array['Lafayette']),
  ('Lemonade Life', array['Lemonade']),
  ('Liberty Bankers Life', array['LBIG','Liberty Bankers']),
  ('Liberty National', array['Liberty National Life']),
  ('Life Insurance Company of Alabama', array['LICOA']),
  ('Lincoln Benefit Life', array['Lincoln Benefit','LBL']),
  ('Lincoln Financial', array['Lincoln National Life','Lincoln Life','LFG','Lincoln','First Penn-Pacific','Jefferson-Pilot']),
  ('Lincoln Heritage', array['Lincoln Heritage Life','Funeral Advantage']),
  ('Lumico Life', array['Lumico']),
  ('Madison National Life', array['Madison National']),
  ('ManhattanLife', array['Manhattan Life','Western United Life','Family Life Insurance Company']),
  ('MassMutual', array['Massachusetts Mutual','Massachusetts Mutual Life','Mass Mutual','C.M. Life']),
  ('MassMutual Ascend', array['Great American Life','Annuity Investors Life']),
  ('MetLife', array['Travelers Life','Metropolitan Life','Metropolitan Life Insurance','FEGLI']),
  ('Midland National', array['Sammons Financial','Sammons','Midland National Life']),
  ('Minnesota Life', array['Securian','Securian Financial','Minnesota Mutual']),
  ('Modern Woodmen', array['Modern Woodmen of America']),
  ('Mutual of America', array['Mutual of America Life']),
  ('Mutual of Omaha', array['United of Omaha','United of Omaha Life','Companion Life','Mutual of Omaha Insurance']),
  ('Mutual Trust Life', array['Mutual Trust']),
  ('Nassau Financial Group', array['Nassau Re','Phoenix Life','Phoenix Mutual','PHL Variable','Nassau Life']),
  ('National Guardian Life', array['NGL','NGL Insurance Group']),
  ('National Life Group', array['National Life','National Life Insurance Company','Life Insurance Company of the Southwest','LSW']),
  ('National Teachers Associates Life', array['NTA Life','NTA']),
  ('National Western', array['National Western Life','NWL']),
  ('Nationwide', array['Nationwide Life','Nationwide Financial']),
  ('Navy Mutual', array['Navy Mutual Aid','Navy Mutual Aid Association']),
  ('New Era Life', array['Philadelphia American Life','New Era']),
  ('New York Life', array['NYL','NYLIC','New York Life Insurance','AARP Life','AARP']),
  ('North American Company', array['North American Company for Life and Health','NACOLAH','North American Life']),
  ('Northwestern Mutual', array['NM','NWM','Northwestern Mutual Life']),
  ('Ohio National', array['AuguStar','AuguStar Life','Ohio National Financial']),
  ('OneAmerica', array['American United Life','AUL','OneAmerica Financial','State Life Insurance Company']),
  ('Oxford Life', array['Oxford Life Insurance Company']),
  ('Pacific Guardian Life', array['PGL']),
  ('Pacific Life', array['Pacific Life Insurance','PacLife','Pacific Life & Annuity']),
  ('Pan-American Life', array['Pan-American','Pan American Life','Pan-American Life Insurance Group']),
  ('Pekin Life', array['Pekin Insurance','Pekin']),
  ('Penn Mutual', array['Penn Mutual Life','Penn Insurance and Annuity']),
  ('Pharmacists Mutual', array['Pharmacists Life']),
  ('Physicians Mutual', array['Physicians Life','Physicians Life Insurance']),
  ('Primerica', array['Primerica Life','National Benefit Life']),
  ('Principal', array['Principal Financial','Principal Life','Principal Financial Group']),
  ('Prosperity Life', array['Prosperity Life Group','SBLI USA','S.USA Life','Shenandoah Life']),
  ('Protective Life', array['Protective','Liberty Mutual','Mutual of New York','West Coast Life','United Investors Life','MONY Life','Liberty Life Assurance of Boston','Liberty Life']),
  ('Prudential', array['American Skandia','Pruco Life','Prudential Financial','The Prudential','Pru','SGLI','VGLI']),
  ('Reliance Standard', array['Reliance Standard Life','Reliance Matrix']),
  ('RiverSource', array['RiverSource Life','Ameriprise','Ameriprise Financial','IDS Life']),
  ('Royal Neighbors of America', array['Royal Neighbors','RNA']),
  ('Sagicor Life', array['Sagicor']),
  ('SBLI', array['Savings Bank Life Insurance','SBLI of Massachusetts','The Savings Bank Mutual Life']),
  ('Security Benefit', array['Security Benefit Life']),
  ('Security Mutual Life of New York', array['Security Mutual','Security Mutual Life']),
  ('Security National Life', array['Security National Financial','Security National']),
  ('Senior Life', array['Senior Life Insurance Company']),
  ('Sentinel Security Life', array['Sentinel Security','Atlantic Coast Life']),
  ('Shelter Life', array['Shelter Insurance','Shelter']),
  ('Sons of Norway', array['Sons of Norway Financial']),
  ('Southern Farm Bureau Life', array['Southern Farm Bureau','Texas Farm Bureau','Kentucky Farm Bureau','Florida Farm Bureau']),
  ('Standard Insurance', array['The Standard','Standard Life']),
  ('Standard Security Life of New York', array['Standard Security Life']),
  ('State Farm', array['State Farm Life','State Farm Life Insurance']),
  ('Sun Life', array['Sun Life Financial']),
  ('Symetra', array['Symetra Life']),
  ('Talcott Resolution', array['Hartford Life','The Hartford','Talcott']),
  ('Tennessee Farmers Life', array['Tennessee Farm Bureau','Tennessee Farmers']),
  ('Texas Life', array['Texas Life Insurance Company']),
  ('Thrivent', array['Thrivent Financial','Lutheran Brotherhood','Aid Association for Lutherans']),
  ('TIAA', array['TIAA-CREF','TIAA Life','TIAA-CREF Life']),
  ('Transamerica', array['Western Reserve Life','Peoples Benefit Life','Transamerica Life','Transamerica Premier','Aegon','Monumental Life','Stonebridge Life','Life Investors','World Financial Group','WFG']),
  ('Trinity Life', array['Trinity Life Insurance Company','Family Benefit Life']),
  ('TruStage', array['CMFG Life','CUNA Mutual','MEMBERS Life','CUNA']),
  ('Trustmark', array['Trustmark Life','Trustmark Voluntary Benefits']),
  ('Ullico', array['Union Labor Life']),
  ('United American', array['United American Insurance Company']),
  ('United Heritage Life', array['United Heritage']),
  ('United Home Life', array['UHL','Indiana Farm Bureau']),
  ('Unity Financial Life', array['Unity Financial']),
  ('Unum', array['Unum Life','UNUM']),
  ('USAA Life', array['USAA']),
  ('USAble Life', array['USAble']),
  ('Vantis Life', array['Vantis']),
  ('Venerable', array['Venerable Insurance and Annuity']),
  ('Voya', array['Golden American Life','ReliaStar Life','Security Life of Denver','ING Life','Voya Financial']),
  ('Washington National', array['Washington National Insurance']),
  ('Wellabe', array['Medico','Medico Life and Health','EMC National Life']),
  ('Western & Southern', array['Western & Southern Life','Western and Southern','Western Southern']),
  ('Western Fraternal Life', array['WFLA']),
  ('William Penn', array['William Penn Life','Legal & General (William Penn)']),
  ('Woman''s Life Insurance Society', array['WLIS','Womans Life']),
  ('WoodmenLife', array['Woodmen of the World','Woodmen Life','Woodmen']),
  ('Wysh Life', array['Wysh']),
  ('Zurich American Life', array['Kemper Investors Life','Zurich Life','Zurich']),
  -- Final expense, preneed and smaller life carriers agents run into.
  ('American Benefit Life', array['ABL']),
  ('Amalgamated Life', array['Amalgamated Life Insurance']),
  ('American Progressive Life & Health', array['American Progressive','Universal American']),
  ('Cherokee National Life', array['Cherokee National']),
  ('First United American Life', array['First United American']),
  ('Greek Catholic Union', array['GCU']),
  ('Gulf Guaranty Life', array['Gulf Guaranty']),
  ('Loyal Christian Benefit Association', array['LCBA']),
  ('Merit Life', array['Merit Life Insurance']),
  ('National Income Life', array['National Income']),
  ('National Mutual Benefit', array['National Mutual Benefit Society']),
  ('North Coast Life', array['North Coast Life Insurance']),
  ('Paul Revere Life', array['Paul Revere']),
  ('Provident Life and Accident', array['Provident Life','Provident']),
  ('Royal Arcanum', array['Royal Arcanum Fraternal']),
  ('Slovene National Benefit Society', array['SNPJ']),
  ('Sons of Hermann', array['Order of the Sons of Hermann']),
  ('American Capitol Insurance', array['ACL','American Capitol']),
  ('American Republic', array['American Republic Insurance','ARIC']),
  ('Bluebonnet Life', array['Bluebonnet']),
  ('Capitol Life', array['Capitol Life Insurance Company']),
  ('Catholic United Financial', array['Catholic United']),
  ('Central States Indemnity', array['CSI','Central States']),
  ('Central United Life', array['Central United']),
  ('Christian Fidelity Life', array['Christian Fidelity']),
  ('Continental General', array['Continental General Insurance']),
  ('Croatian Fraternal Union', array['CFU']),
  ('Equitable Life & Casualty', array['Equitable Life and Casualty']),
  ('Farm Family Life', array['Farm Family']),
  ('First Catholic Slovak Ladies Association', array['FCSLA']),
  ('Heartland National Life', array['Heartland National']),
  ('Independence American', array['Independence Holding','IHC']),
  ('Investors Life', array['Investors Life Insurance Company of North America']),
  ('Life Insurance Company of North America', array['LINA','New York Life Group Benefit Solutions']),
  ('Midwest Holding', array['American Life & Security','American Life and Security']),
  ('National Security Group', array['National Security Insurance']),
  ('Old Republic Life', array['Old Republic']),
  ('Order of United Commercial Travelers', array['UCT','United Commercial Travelers']),
  ('Pioneer Mutual Life', array['Pioneer Mutual']),
  ('Polish Falcons of America', array['Polish Falcons']),
  ('Polish National Alliance', array['PNA']),
  ('Puritan Life', array['Puritan','Puritan Life Insurance Company of America']),
  ('Sentry Life', array['Sentry Insurance','Sentry']),
  ('Standard Life and Accident', array['Standard Life & Accident','SLAICO']),
  ('Ukrainian National Association', array['UNA']),
  ('Unified Life', array['Unified Life Insurance Company']),
  ('Union Fidelity Life', array['Union Fidelity']),
  ('Universal Fidelity Life', array['Universal Fidelity']),
  ('Wilton Re', array['Wilton Reassurance Life','Valley Forge Life']),
  ('Woodmen Accident and Life', array['Woodmen Accident'])
)
, upd as (
  update public.carriers c
     set aliases = (select coalesce(array_agg(distinct a order by a), '{}') from unnest(c.aliases || s.aliases) a)
    from seed s
   where lower(c.name) = lower(s.name)
  returning c.name
)
insert into public.carriers (name, aliases, is_active)
select s.name, s.aliases, true
  from seed s
 where not exists (select 1 from public.carriers c where lower(c.name) = lower(s.name));

-- ── Hours for the 20 researched carriers (vault: brain/carrier-hours.md) ────
-- State Farm, Corebridge and TruStage get no hours: they are looked up live
-- the first time an agent picks them. Prudential (third-party source) and
-- Mutual of Omaha (zone inferred from HQ) are 'ai'; the rest were read on the
-- carrier's own page.
with h(name, phone, hours, tz, src, status, rank) as (values
  ('Pacific Life', '(800) 347-7787',
    '{"mon":{"open":"06:00","close":"17:00"},"tue":{"open":"06:00","close":"17:00"},"wed":{"open":"06:00","close":"17:00"},"thu":{"open":"06:00","close":"17:00"},"fri":{"open":"06:00","close":"17:00"},"sat":null,"sun":null}',
    'America/Los_Angeles', 'https://www.pacificlife.com/home/contact-us.html', 'verified', 1),
  ('Northwestern Mutual', '(866) 950-4644',
    '{"mon":{"open":"07:00","close":"18:00"},"tue":{"open":"07:00","close":"18:00"},"wed":{"open":"07:00","close":"18:00"},"thu":{"open":"07:00","close":"18:00"},"fri":{"open":"07:00","close":"18:00"},"sat":null,"sun":null}',
    'America/Chicago', 'https://www.northwesternmutual.com/contact-us/', 'verified', 2),
  ('Prudential', '(800) 778-2255',
    '{"mon":{"open":"08:00","close":"20:00"},"tue":{"open":"08:00","close":"20:00"},"wed":{"open":"08:00","close":"20:00"},"thu":{"open":"08:00","close":"20:00"},"fri":{"open":"08:00","close":"20:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://legalclarity.org/', 'ai', 3),
  ('Nationwide', '(800) 848-6331',
    '{"mon":{"open":"08:00","close":"20:00"},"tue":{"open":"08:00","close":"20:00"},"wed":{"open":"08:00","close":"20:00"},"thu":{"open":"08:00","close":"20:00"},"fri":{"open":"08:00","close":"20:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://www.nationwide.com/personal/contact/call-us', 'verified', 4),
  ('New York Life', '(800) 225-5695',
    '{"mon":{"open":"08:00","close":"19:00"},"tue":{"open":"08:00","close":"19:00"},"wed":{"open":"08:00","close":"19:00"},"thu":{"open":"08:00","close":"19:00"},"fri":{"open":"08:00","close":"19:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://www.newyorklife.com/contact-us', 'verified', 5),
  ('MassMutual', '(800) 272-2216',
    '{"mon":{"open":"08:00","close":"20:00"},"tue":{"open":"08:00","close":"20:00"},"wed":{"open":"08:00","close":"20:00"},"thu":{"open":"08:00","close":"20:00"},"fri":{"open":"08:00","close":"20:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://www.massmutual.com/contact-us', 'verified', 6),
  ('State Farm', '(800) 782-8332', null, null, null, null, 7),
  ('National Life Group', '(800) 732-8939',
    '{"mon":{"open":"08:00","close":"21:00"},"tue":{"open":"08:00","close":"21:00"},"wed":{"open":"08:00","close":"21:00"},"thu":{"open":"08:00","close":"21:00"},"fri":{"open":"08:00","close":"19:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://www.nationallife.com/Contact-For-Policy-Holders', 'verified', 8),
  ('Transamerica', '(800) 851-9777',
    '{"mon":{"open":"08:00","close":"19:00"},"tue":{"open":"08:00","close":"19:00"},"wed":{"open":"08:00","close":"19:00"},"thu":{"open":"08:00","close":"19:00"},"fri":{"open":"08:00","close":"19:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://tlic.transamerica.com/', 'verified', 9),
  ('Mutual of Omaha', '(800) 775-6000',
    '{"mon":{"open":"08:30","close":"16:30"},"tue":{"open":"08:30","close":"16:30"},"wed":{"open":"08:30","close":"16:30"},"thu":{"open":"08:30","close":"16:30"},"fri":{"open":"08:30","close":"16:30"},"sat":null,"sun":null}',
    'America/Chicago', 'https://www.mutualofomaha.com/life-insurance/contact', 'ai', 10),
  ('John Hancock', '(800) 732-5543',
    '{"mon":{"open":"09:00","close":"17:00"},"tue":{"open":"09:00","close":"17:00"},"wed":{"open":"09:00","close":"17:00"},"thu":{"open":"09:00","close":"17:00"},"fri":{"open":"09:00","close":"17:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://www.johnhancock.com/', 'verified', 11),
  ('Penn Mutual', '(800) 523-0650',
    '{"mon":{"open":"08:30","close":"18:00"},"tue":{"open":"08:30","close":"18:00"},"wed":{"open":"08:30","close":"18:00"},"thu":{"open":"08:30","close":"18:00"},"fri":{"open":"08:30","close":"18:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://www.pennmutual.com/contact-us', 'verified', 12),
  ('Lincoln Financial', '(800) 487-1485',
    '{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"18:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://www.lfg.com/', 'verified', 13),
  ('Guardian Life', '(888) 482-7342',
    '{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"17:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://www.guardianlife.com/contact-us', 'verified', 14),
  ('Corebridge', '(800) 888-2452', null, null, null, null, 15),
  ('Allianz Life', '(800) 950-1962',
    '{"mon":{"open":"08:00","close":"17:00"},"tue":{"open":"08:00","close":"17:00"},"wed":{"open":"08:00","close":"17:00"},"thu":{"open":"08:00","close":"17:00"},"fri":{"open":"08:00","close":"17:00"},"sat":null,"sun":null}',
    'America/Chicago', 'https://www.allianzlife.com/contact-us', 'verified', 16),
  ('Americo', '(816) 641-2850',
    '{"mon":{"open":"08:00","close":"17:00"},"tue":{"open":"08:00","close":"17:00"},"wed":{"open":"08:00","close":"17:00"},"thu":{"open":"08:00","close":"17:00"},"fri":{"open":"08:00","close":"17:00"},"sat":null,"sun":null}',
    'America/Chicago', 'https://www.americo.com/contact', 'verified', 17),
  ('TruStage', null, null, null, null, null, 18),
  ('Midland National', '(800) 923-3223',
    '{"mon":{"open":"07:30","close":"17:00"},"tue":{"open":"07:30","close":"17:00"},"wed":{"open":"07:30","close":"17:00"},"thu":{"open":"07:30","close":"17:00"},"fri":{"open":"07:30","close":"12:30"},"sat":null,"sun":null}',
    'America/Chicago', 'https://www.midlandnational.com/contact-us', 'verified', 19),
  ('Banner Life', '(800) 638-8428',
    '{"mon":{"open":"08:00","close":"17:00"},"tue":{"open":"08:00","close":"17:00"},"wed":{"open":"08:00","close":"17:00"},"thu":{"open":"08:00","close":"17:00"},"fri":{"open":"08:00","close":"17:00"},"sat":null,"sun":null}',
    'America/New_York', 'https://my.bannerlife.com/corporate/contact', 'verified', 20)
)
update public.carriers c
   set service_phone    = h.phone,
       hours            = h.hours::jsonb,
       hours_tz         = h.tz,
       hours_source_url = h.src,
       hours_status     = h.status,
       hours_checked_at = case when h.hours is null then null else now() end,
       sort_rank        = h.rank
  from h
 where lower(c.name) = lower(h.name);

-- Carriers agents here have already booked against, then common final
-- expense / mortgage protection names, rank after the top 20.
update public.carriers set sort_rank = r.rank
  from (values
    ('Aetna', 21), ('American Amicable', 22), ('Foresters', 23), ('Royal Neighbors of America', 24),
    ('Gerber Life', 25), ('Colonial Penn', 26), ('Globe Life', 27), ('MetLife', 28), ('Fidelity Life', 29),
    ('F&G', 30), ('Aflac', 31), ('Baltimore Life', 32), ('Ethos', 33), ('Liberty Bankers Life', 34),
    ('Sentinel Security Life', 35), ('CICA Life', 36), ('Great Western', 37), ('Lincoln Heritage', 38),
    ('American Income Life', 39), ('Protective Life', 40), ('Principal', 41), ('Primerica', 42),
    ('Symetra', 43), ('Securian', 44), ('Minnesota Life', 44), ('Brighthouse Financial', 45),
    ('Equitable', 46), ('Genworth', 47), ('Chubb', 48), ('SBLI', 49), ('Assurity', 50)
  ) as r(name, rank)
 where lower(carriers.name) = lower(r.name) and carriers.sort_rank is null;

-- ── An agent's "Use "<text>"" adds a carrier (RLS is admin-write) ───────────
-- Returns the existing row when the name or an alias already matches, so a
-- typed variant never makes a duplicate.
create or replace function public.carrier_add(p_name text)
returns public.carriers
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_row public.carriers;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('agent', 'admin') and is_active) then
    raise exception 'Only agents can add a carrier';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Carrier name should be 2 to 80 characters'; end if;

  select * into v_row from public.carriers
   where lower(name) = lower(v_name) or exists (select 1 from unnest(aliases) a where lower(a) = lower(v_name))
   order by (lower(name) = lower(v_name)) desc
   limit 1;
  if found then return v_row; end if;

  insert into public.carriers (name, is_active, hours_status)
  values (v_name, true, 'pending')
  on conflict (name) do nothing
  returning * into v_row;
  if v_row.id is null then select * into v_row from public.carriers where name = v_name; end if;
  return v_row;
end $$;

revoke all on function public.carrier_add(text) from public;
grant execute on function public.carrier_add(text) to authenticated;

-- ── Give an older booking its carrier (My Pipeline Move / Re-book) ──────────
-- Sets policies.carrier_id + carrier_name and the intake note Fulfillment
-- reads ("Cancel with <carrier>"). The booking's own agent or an admin only.
create or replace function public.agent_set_booking_carrier(p_policy uuid, p_carrier uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_agent uuid;
  v_name text;
begin
  select agent_id into v_agent from public.policies where id = p_policy;
  if v_agent is null then raise exception 'Booking not found'; end if;
  if v_agent <> auth.uid() and not public.is_admin() then raise exception 'Not your booking'; end if;
  select name into v_name from public.carriers where id = p_carrier;
  if v_name is null then raise exception 'Carrier not found'; end if;

  update public.policies set carrier_id = p_carrier, carrier_name = v_name where id = p_policy;
  insert into public.policy_fulfillment_details (policy_id, current_carrier)
  values (p_policy, v_name)
  on conflict (policy_id) do update set current_carrier = excluded.current_carrier;
end $$;

revoke all on function public.agent_set_booking_carrier(uuid, uuid) from public;
grant execute on function public.agent_set_booking_carrier(uuid, uuid) to authenticated;
