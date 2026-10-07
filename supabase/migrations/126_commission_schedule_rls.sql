-- P713: commission_schedule was publicly readable+writable (RLS off). Global reference table.
alter table public.commission_schedule enable row level security;

drop policy if exists commission_schedule_select_authenticated on public.commission_schedule;
create policy commission_schedule_select_authenticated on public.commission_schedule
  for select to authenticated using (true);

drop policy if exists commission_schedule_admin_insert on public.commission_schedule;
create policy commission_schedule_admin_insert on public.commission_schedule
  for insert to authenticated with check (public.is_admin());

drop policy if exists commission_schedule_admin_update on public.commission_schedule;
create policy commission_schedule_admin_update on public.commission_schedule
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists commission_schedule_admin_delete on public.commission_schedule;
create policy commission_schedule_admin_delete on public.commission_schedule
  for delete to authenticated using (public.is_admin());
