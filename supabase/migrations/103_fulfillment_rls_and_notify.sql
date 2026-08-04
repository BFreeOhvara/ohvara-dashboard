-- Prompt 418 part 2: is_fulfillment() helper (same pattern as is_admin()),
-- new ADDITIVE select/update policies on policies scoped narrowly to
-- fulfillment_assigned = true (does not touch/weaken policies_select or
-- policies_update — those keep governing the agent/downline/admin path),
-- and the handoff-complete notification trigger (same shape as migration
-- 090's bug_reports_notify / security definer, fires on the DB event).

create or replace function public.is_fulfillment()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'fulfillment'
  )
$$;

create policy "fulfillment_select_assigned" on public.policies
  for select
  using (fulfillment_assigned = true and public.is_fulfillment());

create policy "fulfillment_update_assigned" on public.policies
  for update
  using (fulfillment_assigned = true and public.is_fulfillment())
  with check (fulfillment_assigned = true and public.is_fulfillment());

create or replace function public.fulfillment_complete_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfillment_stage = 'Complete'
     and old.fulfillment_stage is distinct from new.fulfillment_stage then
    insert into notifications (profile_id, type, message, data)
    values (
      new.agent_id, 'fulfillment_complete',
      'Your submission for ' ||
        coalesce(nullif(trim(new.client_first_name || ' ' || new.client_last_name), ''), 'a client') ||
        ' has been completed by Fulfillment.',
      jsonb_build_object('policy_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists policies_fulfillment_complete_notify on policies;
create trigger policies_fulfillment_complete_notify
  after update of fulfillment_stage on policies
  for each row execute function public.fulfillment_complete_notify();
