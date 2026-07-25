-- Prompt 334: closes out all 12 carrier logos. Wires in Brayden's 5 newest
-- real images (Corebridge, F&G, Fidelity Life, Foresters, Mutual of Omaha),
-- flips Ethos to cover mode (no new image needed, matches the Aflac/Chubb
-- treatment), and points National Life Group at a locally-cropped version
-- of its existing asset with the "Experience Life" tagline removed
-- (cropped losslessly, no new image sourced — see LIVE_STATE for the exact
-- pixel range). Transamerica confirmed fine as-is, no change.
update carriers set logo_url = '/carrier-logos/corebridge.png',      logo_fit_mode = 'cover'   where name = 'Corebridge';
update carriers set logo_url = '/carrier-logos/fg.png',              logo_fit_mode = 'contain' where name = 'F&G';
update carriers set logo_url = '/carrier-logos/fidelity-life.png',   logo_fit_mode = 'contain' where name = 'Fidelity Life';
update carriers set logo_url = '/carrier-logos/foresters.png',       logo_fit_mode = 'cover'   where name = 'Foresters';
update carriers set logo_url = '/carrier-logos/mutual-of-omaha.png', logo_fit_mode = 'cover'   where name = 'Mutual of Omaha';

update carriers set logo_fit_mode = 'cover' where name = 'Ethos';

update carriers set logo_url = '/carrier-logos/national-life-group.png', logo_fit_mode = 'cover' where name = 'National Life Group';
