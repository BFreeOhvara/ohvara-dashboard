-- 174 — Agent on-duty status, for live transfers (Goal 7: "Live transfers need
-- to know which agents can take a call now").
--
-- NOT APPLIED. Written from a worktree; applying it is a separate, checked
-- step. Additive only: one new table, two trigger functions, one read function.
--
-- Rebuilt on master from 172_agent_duty.sql on branch
-- atlas/51e53ca5-migration-162-agent-duty-table-o (c53e7d6), which is not
-- merged. The runner reserved 174 for this rebuild, so the ledger's 172 row
-- moves here. Final names (other tasks build against them):
--
--   table    public.agent_duty (agent_id uuid pk -> profiles, on_duty boolean,
--            since timestamptz, updated_at timestamptz)
--   function public.on_duty_agents() -> (agent_id, full_name, since)
--
-- One row per agent saying whether they are on duty right now. Each agent sees
-- and flips only their own row: the select / insert / update policies all pin
-- agent_id to auth.uid(). There is no delete policy, so a row can only be
-- switched off, never removed from the browser; it goes with the profile (on
-- delete cascade). Admins can read every row (public.is_admin(), 152).
-- Fulfillment gets nothing: agent_duty_guard refuses a row for anyone who
-- isn't an active agent, so a Fulfillment rep or admin can't make one. An
-- agent whose access is off can't write at all (block_inactive_writer, 151).
--
-- since is stamped by the server when on_duty turns true and cleared when it
-- turns off; the browser can only write on_duty.
--
-- on_duty_agents() is security definer so it can read every row, which is why
-- public.is_admin() sits inside it: anyone else who calls it gets zero rows.

create table if not exists public.agent_duty (
  agent_id   uuid primary key references public.profiles(id) on delete cascade,
  on_duty    boolean not null default false,
  since      timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.agent_duty enable row level security;

drop policy if exists agent_duty_select_own on public.agent_duty;
drop policy if exists agent_duty_select_admin on public.agent_duty;
drop policy if exists agent_duty_insert_own on public.agent_duty;
drop policy if exists agent_duty_update_own on public.agent_duty;

create policy agent_duty_select_own on public.agent_duty
  for select to authenticated using (auth.uid() = agent_id);
create policy agent_duty_select_admin on public.agent_duty
  for select to authenticated using (public.is_admin());
create policy agent_duty_insert_own on public.agent_duty
  for insert to authenticated with check (auth.uid() = agent_id);
create policy agent_duty_update_own on public.agent_duty
  for update to authenticated using (auth.uid() = agent_id) with check (auth.uid() = agent_id);

revoke all on public.agent_duty from anon, authenticated;
grant select on public.agent_duty to authenticated;
grant insert (agent_id, on_duty) on public.agent_duty to authenticated;
grant update (on_duty) on public.agent_duty to authenticated;

-- ── server-owned columns + agents only ──────────────────────────────────────
-- Signed-in writers must be an active agent writing their own row (RLS already
-- pins the id). The cron and edge functions (no signed-in user) skip the role
-- check. since and updated_at are always set here, whatever the caller sent.
create or replace function public.agent_duty_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if auth.uid() is not null
     and not exists (select 1 from public.profiles
                      where id = new.agent_id and role = 'agent' and is_active) then
    raise exception 'Only an active agent can go on duty.' using errcode = '42501';
  end if;

  if not new.on_duty then
    new.since := null;
  elsif tg_op = 'INSERT' or not old.on_duty then
    new.since := now();
  else
    new.since := old.since;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.agent_duty_guard() from public, anon, authenticated;

-- a0_ runs first (triggers fire in name order), the same name 151 uses.
drop trigger if exists a0_block_inactive_writer on public.agent_duty;
create trigger a0_block_inactive_writer
  before insert or update or delete on public.agent_duty
  for each row execute function public.block_inactive_writer();

drop trigger if exists agent_duty_guard on public.agent_duty;
create trigger agent_duty_guard
  before insert or update on public.agent_duty
  for each row execute function public.agent_duty_guard();

-- ── who can take a call now (admins only) ───────────────────────────────────
-- Columns are qualified with aliases: the returns-table names (agent_id,
-- since) would otherwise shadow the table's own columns.
create or replace function public.on_duty_agents()
 returns table (agent_id uuid, full_name text, since timestamptz)
 language sql
 stable security definer
 set search_path = public
as $$
  select d.agent_id, p.full_name, d.since
    from public.agent_duty d
    join public.profiles p on p.id = d.agent_id
   where public.is_admin()
     and d.on_duty
     and p.is_active
     and p.role = 'agent'
   order by d.since, p.full_name;
$$;

revoke execute on function public.on_duty_agents() from public, anon;
grant execute on function public.on_duty_agents() to authenticated;
