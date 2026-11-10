-- p922_locked_doors — pgTAP checks for 259_lock_doors.sql, and a tripwire for every later migration:
-- signed out (anon) can run no public function and touch no public table; trigger functions and the
-- server-only jobs can't be called by signed-in people; every public function has a fixed search_path;
-- a self sign-up can't make itself an admin; the tightened leads / calls / policy-docs rules hold.
--
-- A later migration that adds a function must `revoke execute on function ... from public, anon`
-- (and grant authenticated only if the app calls it). This file fails `npm run test:sql` otherwise
-- and names the function.
--
-- RUN: `npm run test:sql -- supabase/tests/p922_locked_doors.sql` (PGlite, in memory). Never against live.
-- The live version of these checks is scripts/security/stranger-test.sql (rolled back).

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p') and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  null, 'signed out runs no public function');

select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  null, 'signed-in people call no trigger function');

select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('lead_pause_daily', 'request_rep_leads')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  null, 'server-only jobs are off the API');

select is(
  (select string_agg(c.relname, ', ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and c.relname <> 'carriers' -- read kept for the phone app before sign-in; row rules give 0 rows
      and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
        or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))),
  null, 'signed out touches no public table or view (carriers: read only, 0 rows)');

select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proconfig is null
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  null, 'every public function has a fixed search_path');

-- The app's own calls still work for signed-in people (spot checks).
select ok(has_function_privilege('authenticated', 'public.get_my_profile()', 'execute')
      and has_function_privilege('authenticated', 'public.is_admin()', 'execute'),
  'signed-in people keep the app''s functions');

-- A self sign-up asking for admin in its user data becomes an agent; asking in app data is refused.
insert into public.pending_signups (email, role, source) values ('p922_self@example.invalid', 'agent', 'self');
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a9220000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated',
        'p922_self@example.invalid', '{"provider":"email","role":"agent"}', '{"role":"admin"}', now(), now());
select is((select role::text || ' ' || signup_source from public.profiles where id = 'a9220000-0000-4000-8000-00000000000a'),
  'agent self', 'self sign-up asking for admin becomes a self-signed-up agent');
select throws_ok($$
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', 'a9220000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated',
          'p922_admin@example.invalid', '{"provider":"email","role":"admin"}', '{}', now(), now())
$$, '42501', null, 'an account asking for admin is refused');

-- The tightened rules.
select ok((select qual from pg_policies where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_rep_update')
          !~ 'agent', 'leads: an agent updates only leads assigned to them');
select ok((select with_check from pg_policies where schemaname = 'storage' and policyname = 'policy_docs_insert')
          ~ 'foldername', 'policy-docs: uploads go into a real policy folder');

select * from finish();
rollback;
