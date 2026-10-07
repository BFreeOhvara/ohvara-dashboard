-- Prompt 712 — Premium weekly submission cap 14 -> 16.
-- agent_billing_tiers.weekly_cap is the single source of truth: the
-- enforce_weekly_submission_cap trigger, the agent_weekly_usage view (and so
-- "X of Y used") and the plan cards all read it. Standard stays 7. Price and
-- Stripe ids untouched.

update public.agent_billing_tiers
   set weekly_cap = 16, updated_at = now()
 where key = 'premium';
