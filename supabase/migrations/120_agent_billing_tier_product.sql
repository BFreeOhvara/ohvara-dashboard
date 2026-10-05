-- Prompt 692 follow-up: each tier needs its own Stripe Product. The Customer
-- Portal's plan switcher refuses two Prices with the same billing interval
-- under one Product ("its price must have unique billing intervals"), so the
-- weekly Prices for Standard and Premium can't share one. The agent-billing
-- function records each tier's Product here, alongside stripe_price_id.

alter table public.agent_billing_tiers
  add column if not exists stripe_product_id text;
