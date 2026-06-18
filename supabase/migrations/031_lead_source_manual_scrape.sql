-- Migration 031: add 'manual_scrape' to the lead_source enum.
--
-- The leads.source column is the enum `lead_source`, previously {google_maps, indeed}.
-- Manually-scraped Indeed batches (browser-extension CSV exports, filtered + phone-
-- enriched by hand outside the Apify pipeline) are tagged source='manual_scrape' so
-- they are distinguishable from pipeline-sourced leads and the batch stays identifiable
-- for auditing / rollback. Additive and non-breaking — existing values are unchanged.

ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'manual_scrape';
