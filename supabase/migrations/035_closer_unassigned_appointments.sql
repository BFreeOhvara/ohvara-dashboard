-- 035_closer_unassigned_appointments.sql
-- Bug: provision-client/booking flow leaves appointments.closer_id NULL until
-- a closer actually closes the deal, but appointments_closer_select/_update
-- (001_initial_schema.sql) only granted access when closer_id = auth.uid() —
-- so an unassigned pending appointment was invisible to every closer (Admin
-- Pipeline > Booked showed 3 pending appointments, nate44's /closer saw none).
-- Fix: any closer can SELECT/UPDATE an appointment that's either theirs or
-- still unassigned. Correct while there's one active closer (Nate); once a
-- second closer is live this also lets either one claim/work an unassigned
-- booking, not just view it.

drop policy if exists "appointments_closer_select" on appointments;
create policy "appointments_closer_select" on appointments
  for select using (
    closer_id = auth.uid()
    or rep_id = auth.uid()
    or (
      closer_id is null
      and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'closer')
    )
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "appointments_closer_update" on appointments;
create policy "appointments_closer_update" on appointments
  for update using (
    closer_id = auth.uid()
    or (
      closer_id is null
      and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'closer')
    )
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
