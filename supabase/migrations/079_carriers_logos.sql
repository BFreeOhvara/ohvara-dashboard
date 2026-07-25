-- Prompt 331: carrier logos, sourced from each carrier's official brand
-- assets (Wikipedia/Wikimedia infobox logos, or the carrier's own site)
-- and downloaded into public/carrier-logos/. Fidelity Life has no entry —
-- fidelitylife.com was unreachable and no other clean official asset was
-- found; the UI falls back to a text/initial badge for it.
update carriers set logo_url = '/carrier-logos/mutual-of-omaha.svg'      where name = 'Mutual of Omaha';
update carriers set logo_url = '/carrier-logos/transamerica.svg'        where name = 'Transamerica';
update carriers set logo_url = '/carrier-logos/corebridge.svg'          where name = 'Corebridge';
update carriers set logo_url = '/carrier-logos/ethos.png'               where name = 'Ethos';
update carriers set logo_url = '/carrier-logos/american-amicable.png'   where name = 'American Amicable';
update carriers set logo_url = '/carrier-logos/baltimore-life.png'      where name = 'Baltimore Life';
update carriers set logo_url = '/carrier-logos/aflac.png'               where name = 'Aflac';
update carriers set logo_url = '/carrier-logos/chubb.svg'               where name = 'Chubb';
update carriers set logo_url = '/carrier-logos/national-life-group.png' where name = 'National Life Group';
update carriers set logo_url = '/carrier-logos/foresters.svg'           where name = 'Foresters';
update carriers set logo_url = '/carrier-logos/f-and-g.png'             where name = 'F&G';
