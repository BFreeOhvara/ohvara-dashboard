-- Migration 075 — Per-closer monthly AP goal (Prompt 329, Overview item 7)
--
-- Overview's new "monthly goal progress" box needs a target to compare
-- submitted AP against. There's no fixed company target, so it's a
-- per-closer field they set themselves in Settings — this just adds the
-- column with a reasonable placeholder default until each closer sets
-- their own.
alter table profiles
  add column if not exists monthly_ap_goal numeric not null default 20000;
