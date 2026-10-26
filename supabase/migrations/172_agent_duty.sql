-- Agent on-duty status (brief: "Migration 162", renumbered to 172 because
-- 161-171 are already taken across master and the open atlas/* branches).
--
-- One row per agent saying whether they are on duty right now. Each agent can
-- see and flip only their own row: RLS is on, anon gets nothing, and the
-- select / insert / update policies all pin agent_id to auth.uid(). There is
-- no delete policy, so a row can only be switched off, never removed from the
-- browser; it goes away with the profile (on delete cascade).
--
-- Admins see who is on duty through on_duty_agents(), not through a table
-- policy. It is security definer so it can read every row, and that is why the
-- public.is_admin() check sits inside its body: anyone else who calls it gets
-- zero rows. Execute is revoked from public and anon. is_admin() reads only
-- profiles.role (152), never user_metadata.

create table if not exists public.agent_duty (
  agent_id   uuid primary key references public.profiles(id) on delete cascade,
  on_duty    boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.agent_duty enable row level security;
revoke all on public.agent_duty from anon;

drop policy if exists "agent_duty_select_own" on public.agent_duty;
drop policy if exists "agent_duty_insert_own" on public.agent_duty;
drop policy if exists "agent_duty_update_own" on public.agent_duty;

create policy "agent_duty_select_own" on public.agent_duty
  for select using (auth.uid() = agent_id);

create policy "agent_duty_insert_own" on public.agent_duty
  for insert with check (auth.uid() = agent_id);

create policy "agent_duty_update_own" on public.agent_duty
  for update using (auth.uid() = agent_id) with check (auth.uid() = agent_id);

create or replace trigger agent_duty_updated_at
  before update on public.agent_duty
  for each row execute procedure public.set_updated_at();

-- Columns are qualified with aliases: the returns-table names (agent_id,
-- updated_at) would otherwise shadow the table's own columns.
create or replace function public.on_duty_agents()
returns table (agent_id uuid, full_name text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select d.agent_id, p.full_name, d.updated_at
    from public.agent_duty d
    join public.profiles p on p.id = d.agent_id
   where public.is_admin()
     and d.on_duty
     and p.is_active
   order by p.full_name;
$$;

revoke execute on function public.on_duty_agents() from public, anon;
grant execute on function public.on_duty_agents() to authenticated, service_role;
