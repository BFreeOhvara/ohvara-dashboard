-- Prompt 332: drop CORE CARRIER badge (UI-only, no schema change), swap in
-- Brayden's own replacement logos for the first 4 of 12 carriers (bigger
-- header-style banner treatment), and set Baltimore Life's real agent
-- portal URL (stable redirect_uri decoded from the live OAuth link he sent,
-- not the raw session-specific authorize URL itself).
update carriers set logo_url = '/carrier-logos/aflac.png'             where name = 'Aflac';
update carriers set logo_url = '/carrier-logos/american-amicable.png' where name = 'American Amicable';
update carriers set logo_url = '/carrier-logos/baltimore-life.png'    where name = 'Baltimore Life';
update carriers set logo_url = '/carrier-logos/chubb-combined.png'    where name = 'Chubb';

update carriers set portal_url = 'https://agentportal.baltlife.com/' where name = 'Baltimore Life';
