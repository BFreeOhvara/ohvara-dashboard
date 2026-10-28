-- 166 — Lead types, qualifier answers, delivery.
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only: new columns, checks, an index and policies. Nothing is
-- dropped, renamed or deleted.
--
-- leads (001_initial_schema.sql) only ever held cancellation leads. Now:
--   * lead_type says which kind of lead a row is. Existing rows get
--     'cancellation' from the default;
--   * lead_source says where an inbound lead came from (meta, google,
--     referral). Not the same as leads.source, the older scraper enum
--     (google_maps, indeed, manual_scrape), which stays as is;
--   * qualifier_answers holds the qualifier page's answers as one JSON object;
--   * delivered_at is when the lead was handed to its agent.
--
-- RLS: an agent sees only leads assigned to them; Fulfillment and admin see
-- all. The existing permissive leads_rep_select (036) still lets any agent
-- read a lead that has an appointment. That's the cancellation flow, so it's
-- left alone, and a restrictive policy keeps every other lead type to its
-- assigned agent (plus Fulfillment and admin). The service role (edge
-- functions, agent-api) bypasses RLS as before.

alter table public.leads
  add column if not exists lead_type text not null default 'cancellation'
    check (lead_type in ('cancellation', 'mortgage_protection', 'policy_help', 'policy_review')),
  add column if not exists lead_source text
    check (lead_source in ('meta', 'google', 'referral')),
  add column if not exists qualifier_answers jsonb
    check (qualifier_answers is null or jsonb_typeof(qualifier_answers) = 'object'),
  add column if not exists delivered_at timestamptz;

create index if not exists leads_lead_type_assigned_rep_idx
  on public.leads (lead_type, assigned_rep_id);

-- Fulfillment and admin read every lead (is_fulfillment / is_admin are false
-- once access is off; 151, 152).
create policy leads_fulfillment_select on public.leads
  for select to authenticated
  using (public.is_fulfillment());

create policy leads_admin_select on public.leads
  for select to authenticated
  using (public.is_admin());

-- New lead types: only the assigned agent, Fulfillment or admin.
create policy leads_typed_assigned_only on public.leads
  as restrictive
  for select to authenticated
  using (
    lead_type = 'cancellation'
    or assigned_rep_id = auth.uid()
    or public.is_fulfillment()
    or public.is_admin()
  );
