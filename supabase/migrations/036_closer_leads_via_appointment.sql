-- 036_closer_leads_via_appointment.sql
-- Second half of the Prompt 4 Step 6 closer-visibility bug. 035 fixed
-- appointments RLS so unassigned pending appointments are visible to any
-- closer, but each AppointmentCard then rendered "lead not visible to this
-- account" — leads_rep_select (001_initial_schema.sql) only grants a closer
-- read access when leads.assigned_closer_id = auth.uid(), and that column is
-- only ever set by the separate assign-closer edge function, not at booking
-- time. So an unassigned appointment's lead was invisible too.
--
-- Fix: any closer can read a lead that has an appointment row (booked,
-- regardless of who it's assigned to) — mirrors 035's "any closer can work
-- an unassigned booking" behavior, scoped through the appointment link
-- rather than a second assigned_closer_id check.

drop policy if exists "leads_rep_select" on leads;
create policy "leads_rep_select" on leads
  for select using (
    assigned_rep_id = auth.uid()
    or assigned_closer_id = auth.uid()
    or (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'closer')
      and exists (select 1 from appointments a where a.lead_id = leads.id)
    )
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
