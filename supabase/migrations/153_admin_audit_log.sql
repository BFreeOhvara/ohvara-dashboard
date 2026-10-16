-- 153 — Admin hardening, area 2: an append-only record of admin changes
-- (Prompt 770-2).
--
-- Cancel decisions were already recorded (fulfillment_cancel_events) and
-- Give to too (policy_events 'reassigned'), but role and access changes,
-- settings switches, invites and pay stamps left no trace. Now every one of
-- them writes a row to admin_audit_log: who (auth.uid(), null = cron or an
-- edge function), how (the API role), what changed (old/new values of the
-- changed columns only), when.
--
-- The three logs are append-only for everyone: no grants to signed-in users,
-- and a trigger refuses UPDATE, DELETE and TRUNCATE whoever runs them (the
-- service role and SQL included). Two narrow exceptions:
--   * a log row may be deleted when its call or cancel is deleted (FK
--     cascade, pg_trigger_depth() > 1), so deleting a test call still works;
--   * an event may be annotated in the same transaction that wrote it
--     (fulfillment_correct_result marks its own event as a correction).

create table if not exists public.admin_audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor        uuid,
  actor_name   text,
  via          text,
  action       text not null,
  target_table text not null,
  target_id    text,
  old_values   jsonb,
  new_values   jsonb
);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_table, target_id);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select on public.admin_audit_log to authenticated;
create policy admin_audit_log_admin_select on public.admin_audit_log
  for select to authenticated using (public.is_admin());

-- Generic row logger. Trigger arguments = the columns to watch on UPDATE (none
-- = every column). INSERT/DELETE log the whole row. Secrets never go in.
create or replace function public.audit_row()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  hide text[] := array['token', 'password', 'encrypted_value'];
  o    jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - hide end;
  n    jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - hide end;
  b    jsonb := '{}';
  a    jsonb := '{}';
  k    text;
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if (tg_nargs = 0 or k = any(tg_argv)) and k not in ('updated_at', 'updated_by')
         and (o->k) is distinct from (n->k) then
        b := b || jsonb_build_object(k, o->k);
        a := a || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if a = '{}' then return null; end if;
  else
    b := o;
    a := n;
  end if;
  insert into admin_audit_log (actor, actor_name, via, action, target_table, target_id, old_values, new_values)
  values (auth.uid(),
          (select full_name from profiles where id = auth.uid()),
          coalesce(v_claims->>'role', current_user),
          lower(tg_op), tg_table_name,
          coalesce(n->>'id', o->>'id', n->>'profile_id', o->>'profile_id', n->>'key', o->>'key'),
          b, a);
  return null;
end;
$$;
revoke execute on function public.audit_row() from public, anon, authenticated;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update on public.profiles
  for each row execute function public.audit_row(
    'role', 'is_active', 'upline_id', 'billing_exempt', 'billing_tier', 'stripe_account_id');
drop trigger if exists audit_profiles_insdel on public.profiles;
create trigger audit_profiles_insdel after insert or delete on public.profiles
  for each row execute function public.audit_row();

drop trigger if exists audit_recovery_config on public.recovery_config;
create trigger audit_recovery_config after update on public.recovery_config
  for each row execute function public.audit_row();

drop trigger if exists audit_app_settings on public.app_settings;
create trigger audit_app_settings after update on public.app_settings
  for each row execute function public.audit_row();

drop trigger if exists audit_agent_billing_tiers on public.agent_billing_tiers;
create trigger audit_agent_billing_tiers after insert or update or delete on public.agent_billing_tiers
  for each row execute function public.audit_row();

drop trigger if exists audit_fulfillment_pay on public.fulfillment_pay;
create trigger audit_fulfillment_pay after insert or update or delete on public.fulfillment_pay
  for each row execute function public.audit_row();

drop trigger if exists audit_rep_invites on public.rep_invites;
create trigger audit_rep_invites after insert or update or delete on public.rep_invites
  for each row execute function public.audit_row();

-- Pay stamps: a cancel paid, re-pointed or un-paid; a payout's status.
drop trigger if exists audit_fulfillment_cancels on public.fulfillment_cancels;
create trigger audit_fulfillment_cancels after update on public.fulfillment_cancels
  for each row execute function public.audit_row('paid_at', 'payout_id', 'amount_cents');

drop trigger if exists audit_fulfillment_payouts on public.fulfillment_payouts;
create trigger audit_fulfillment_payouts after update on public.fulfillment_payouts
  for each row execute function public.audit_row('status', 'amount_cents', 'paid_at', 'approved_by', 'stripe_transfer_id');
drop trigger if exists audit_fulfillment_payouts_ins on public.fulfillment_payouts;
create trigger audit_fulfillment_payouts_ins after insert on public.fulfillment_payouts
  for each row execute function public.audit_row();

drop trigger if exists audit_policies_delete on public.policies;
create trigger audit_policies_delete after delete on public.policies
  for each row execute function public.audit_row();

-- Append-only guard. Argument 'cascade_ok' allows the FK cascade delete and a
-- same-transaction annotation (the row's `at` is this transaction's now()).
create or replace function public.log_append_only()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
begin
  if tg_level = 'ROW' and tg_nargs > 0 and tg_argv[0] = 'cascade_ok' then
    if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
      return old;
    end if;
    if tg_op = 'UPDATE' and old.at = now() then
      return new;
    end if;
  end if;
  raise exception '% is a permanent record and can''t be changed', tg_table_name using errcode = '42501';
end;
$$;
revoke execute on function public.log_append_only() from public, anon, authenticated;

drop trigger if exists admin_audit_log_append_only on public.admin_audit_log;
create trigger admin_audit_log_append_only before update or delete on public.admin_audit_log
  for each row execute function public.log_append_only();
drop trigger if exists admin_audit_log_no_truncate on public.admin_audit_log;
create trigger admin_audit_log_no_truncate before truncate on public.admin_audit_log
  for each statement execute function public.log_append_only();

drop trigger if exists fulfillment_cancel_events_append_only on public.fulfillment_cancel_events;
create trigger fulfillment_cancel_events_append_only before update or delete on public.fulfillment_cancel_events
  for each row execute function public.log_append_only('cascade_ok');
drop trigger if exists fulfillment_cancel_events_no_truncate on public.fulfillment_cancel_events;
create trigger fulfillment_cancel_events_no_truncate before truncate on public.fulfillment_cancel_events
  for each statement execute function public.log_append_only();

drop trigger if exists policy_events_append_only on public.policy_events;
create trigger policy_events_append_only before update or delete on public.policy_events
  for each row execute function public.log_append_only('cascade_ok');
drop trigger if exists policy_events_no_truncate on public.policy_events;
create trigger policy_events_no_truncate before truncate on public.policy_events
  for each statement execute function public.log_append_only();
