-- ============================================================
-- Migration 015 — Add 'Callback' to lead_status enum
-- Needed for the rep lead detail panel status dropdown.
-- ============================================================

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'Callback' AFTER 'Interested';
