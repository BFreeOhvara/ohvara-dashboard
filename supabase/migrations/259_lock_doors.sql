-- 259_lock_doors (P922): every door locked.
--
-- Agents sign up themselves, so a brand-new agent account is a stranger. The
-- stranger test (scripts/security/stranger-test.sql) and the door check
-- (scripts/security/door-check.mjs) prove what this closes; rerun both after
-- every big change. Report: brain/ohvara/Security Check.md (Atlas vault).
--
--   1. Signed out (anon) runs no database function and touches no table.
--      Every public page (sign-up, invite, reschedule link, sign link, sign-in,
--      reset) goes through an edge function, which uses the server key. New
--      functions and tables no longer open to anon or PUBLIC by default.
--   2. Trigger functions and server-only jobs can't be called through the API
--      by signed-in people either (triggers still fire; the server key and
--      definer functions still call the jobs).
--   3. A fixed search_path on the functions that had none.
--   4. Storage: avatars take images only (5 MB), bug reports their real file
--      types (50 MB), so nobody parks a web page in a bucket; the admin read
--      of bug screenshots checks is_admin() (turned-off admins out).
--   5. Function guards the stranger test found missing (section 5 below).

-- 1 + 2. Function grants ----------------------------------------------------
do $$
declare
  r record;
  v_auth boolean;
  v_svc boolean;
  -- Called by cron / edge functions with the server key, or only from other
  -- definer functions. Nobody signed in calls them through the API.
  server_only text[] := array[
    'lead_pause_daily',   -- nightly resume of paused leads (cron)
    'request_rep_leads'   -- pre-pivot lead hand-out, nothing calls it
  ];
begin
  for r in
    select p.oid, p.proname, p.prorettype = 'trigger'::regtype as is_trigger,
           p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    -- Keep authenticated and service_role exactly as they were (some had it
    -- only through PUBLIC; some are deliberately closed to the server key).
    v_auth := has_function_privilege('authenticated', r.oid, 'execute');
    v_svc := has_function_privilege('service_role', r.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', r.sig);
    if v_svc then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
    if r.is_trigger or r.proname = any(server_only) then
      execute format('revoke execute on function %s from authenticated', r.sig);
    elsif v_auth then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

-- 1. Tables, views and sequences: nothing for anon.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- One read stays: the phone app's carrier list (useCarriers) also runs before
-- sign-in. Row rules give anon 0 rows, so it reads nothing; the grant only
-- keeps that request from erroring (pinned in p_function_hardening row f).
grant select on public.carriers to anon;

-- New tables and sequences in public: not anon's. New functions still get
-- PUBLIC execute (a global Postgres default; revoking it globally would also
-- strip extension functions made later), so every migration that adds a
-- function revokes it from public, anon itself. supabase/tests/p922_locked_doors.sql
-- fails `npm run test:sql` when one forgets.
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- 3. Fixed search_path ---------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proconfig is null
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- 4. Storage -------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic']
 where id = 'avatars';
-- Report a bug takes images, PDF, text, CSV and short videos (src/template/ReportBug.jsx).
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
                                  'application/pdf', 'text/plain', 'text/csv', 'video/mp4', 'video/quicktime']
 where id = 'bug-screenshots';

drop policy if exists "Admins read all bug screenshots" on storage.objects;
create policy "Admins read all bug screenshots" on storage.objects
  for select to authenticated
  using (bucket_id = 'bug-screenshots' and public.is_admin());

-- 5. Guards the stranger test found missing -------------------------------------

-- 5a. Leads: an agent changes only leads assigned to them. The old rule let
-- any agent update any 'cancellation' lead (pre-pivot type, none on live today).
-- useMpLeads.js updates agent_status on the agent's own leads: still allowed.
drop policy if exists leads_rep_update on public.leads;
create policy leads_rep_update on public.leads
  for update to authenticated
  using (assigned_rep_id = auth.uid() or public.is_admin());

-- 5b. Calls (pre-pivot log, empty on live): only your own rows, or an admin.
-- The old ALL rule let any agent change or delete any rep's calls.
drop policy if exists calls_rep_own on public.calls;
create policy calls_rep_own on public.calls
  for all to authenticated
  using ((rep_id = auth.uid() or public.is_admin())
         and (rep_id = auth.uid() or not (select public.is_locked_self_signup())))
  with check (rep_id = auth.uid() or public.is_admin());

-- 5c. Policy documents: an agent or VA uploads into a real policy's folder
-- only (a VA could use any path before, e.g. an agent's id as a folder).
drop policy if exists policy_docs_insert on storage.objects;
create policy policy_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'policy-docs'
    and (
      public.is_admin() -- admins also upload form templates under templates/
      or exists (
        select 1 from public.policies p
         where p.id::text = (storage.foldername(objects.name))[1]
           and (p.agent_id = auth.uid() or public.is_fulfillment())
      )
    )
  );
