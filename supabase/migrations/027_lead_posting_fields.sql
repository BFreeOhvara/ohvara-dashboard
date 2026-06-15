-- ============================================================
-- Migration 027: Indeed posting provenance fields on leads
-- ============================================================
-- Captures the job-posting context that makes an Indeed lead "warm":
-- the posting headline + a description snippet for the
-- "I saw you're hiring for X" opener, plus the source URL.
-- Populated by the indeed-scraper edge function; null for Maps leads.

alter table leads
  add column if not exists posting_title   text,
  add column if not exists posting_snippet text,
  add column if not exists source_url      text;
