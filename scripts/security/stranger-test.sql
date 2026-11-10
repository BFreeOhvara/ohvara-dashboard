-- P922 stranger test: can a signed-up agent reach anything that isn't theirs?
--
-- HOW TO RUN (live, nothing is saved):
--   Paste this whole file into the Supabase SQL editor (or run it through the
--   Supabase MCP execute_sql tool), then run the select at the bottom once per
--   attacker. Every account, call and write happens inside a block that is
--   rolled back at the end: no account is kept, no row changes.
--
--   select * from pg_temp.st_run('stranger') where outcome like 'FAIL%' or outcome like 'REVIEW%';
--   select * from pg_temp.st_run('agent')    where outcome like 'FAIL%' or outcome like 'REVIEW%';
--   select * from pg_temp.st_run('va')       where outcome like 'FAIL%' or outcome like 'REVIEW%';
--   select * from pg_temp.st_run('anon')     where outcome like 'FAIL%' or outcome like 'REVIEW%';
--   -- summary: select who, kind, split_part(outcome,' ',1) o, count(*) from pg_temp.st_run('stranger') group by 1,2,3 order by 1,2,3;
--
-- WHO ATTACKS
--   stranger  two brand-new agents made the way self-signup makes them
--             (pending_signups row + auth user with app_metadata role agent,
--             plus user_metadata role 'admin' to try to escalate). Stranger A
--             attacks; stranger B is one of the people A tries to reach.
--   agent     an existing paid agent (not the victim) vs the agent with the
--             most clients (the victim): agent A vs agent B by guessing IDs.
--   va        an existing VA (Fulfillment) vs admin-only things.
--   anon      signed out, with only the public key.
--
-- WHAT IT DOES, as that attacker
--   1. Calls EVERY function the API exposes to that role (SECURITY DEFINER and
--      INVOKER), feeding it the victim's real IDs (agent, policy, lead, task,
--      notification, doc, ...) and hostile values (role 'admin').
--        FAIL write   a row that isn't the attacker's changed in any table
--                     (VA: an admin-only table changed)
--        FAIL leak    the answer contains the victim's IDs, client names or
--                     phone numbers (not checked for the VA, who serves every
--                     agent's clients)
--        REVIEW ran   an admin_/va_/fulfillment_ function answered an agent
--                     with something non-empty, or an admin_ function ran for
--                     a VA: read the detail
--        REVIEW other refused with an error that isn't "not allowed": the
--                     function must still be read to prove its guard is first
--        ok           refused with 42501 / "not allowed", or ran harmlessly
--   2. Reads, updates (no-op) and deletes every table and view: counts rows
--      that aren't the attacker's.
--   3. Storage: lists, updates, deletes and uploads into every bucket.
--   4. Escalation: changes its own role, signup source, access and every
--      true/false column on its own profile.
--
-- A change of shape (new table, new function) needs no edit here: the lists
-- come from the catalog each run. Add new ID-type parameter names to st_arg.

create or replace function pg_temp.st_hash(p_tbl text, p_excl text)
returns text language plpgsql as $$
declare v text;
begin
  execute format(
    'select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) from public.%I x where %L = %L or position(%L in x::text) = 0',
    '|', '', p_tbl, coalesce(p_excl, ''), '', coalesce(p_excl, '')) into v;
  return v;
exception when others then return 'ERR';
end $$;

create or replace function pg_temp.st_snap()
returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(relname, n_tup_ins + n_tup_upd + n_tup_del), '{}')
    from pg_stat_xact_user_tables where schemaname = 'public'
$$;

-- A literal for one argument, from its name and type.
create or replace function pg_temp.st_arg(p_name text, p_type text, c jsonb)
returns text language plpgsql as $$
declare n text := coalesce(p_name, '');
  function_uuid text;
begin
  if p_type = 'uuid' then
    function_uuid := case
      when n in ('p_agent','p_user','owner','a','p','p_to','p_signer') then c->>'victim'
      when n in ('p_rep','p_rep_id','p_va') then c->>'va'
      when n in ('p_policy','pid','p_booking_id') then c->>'policy'
      when n = 'p_lead' then c->>'lead'
      when n = 'p_task' then c->>'task'
      when n = 'p_item' then c->>'item'
      when n = 'p_doc' then c->>'doc'
      when n = 'p_send' then c->>'send'
      when n = 'p_review' then c->>'review'
      when n = 'p_intake' then c->>'intake'
      when n = 'p_check' then c->>'check'
      when n = 'p_line' then c->>'line'
      when n = 'p_request' then c->>'request'
      when n in ('p_number','p_id') then c->>'number'
      when n in ('p_carrier','p_new_carrier','p_old_carrier') then c->>'carrier'
      when n = 'p_template' then c->>'template'
      when n = 'p_retry_of' then null
      else c->>'victim' end;
    return coalesce(quote_literal(function_uuid) || '::uuid', 'null::uuid');
  elsif p_type = 'uuid[]' then
    return case when n = 'p_ids' then quote_literal(c->>'notifs')
                when n = 'p_vas' then quote_literal('{' || coalesce(c->>'att', c->>'va') || '}')
                else quote_literal(c->>'policies') end || '::uuid[]';
  elsif p_type = 'text' then
    return quote_literal(case
      when n = 'p_role' then 'admin'
      when n = 'p_tier' then coalesce(c->>'tier', 'pro')
      when n = 'p_to' then 'sold'
      when n in ('p_outcome','p_result') then 'sold'
      when n = 'p_status' then 'available'
      when n = 'p_phone' then '+15555550123'
      when n = 'p_state' then 'TX'
      when n in ('p_timezone','p_tz') then 'America/Chicago'
      when n = 'p_email' then 'p922@example.invalid'
      when n = 'p_code' then '000000'
      when n = 'p_token' then 'p922-token'
      when n = 'p_platform' then 'ios'
      when n = 'p_mode' then 'appointments'
      when n = 'p_channel' then 'fax'
      when n = 'p_client_key' then coalesce(c->>'phone', '+15555550123')
      else 'p922 test' end) || '::text';
  elsif p_type = 'text[]' then return quote_literal('{TX}') || '::text[]';
  elsif p_type = 'jsonb' then
    return quote_literal(case when n in ('p_rows','p_licences','p_signers','p_missed') then '[]'
                              when n = 'p' then '{"role":"admin"}' else '{}' end) || '::jsonb';
  elsif p_type = 'boolean' then return 'true';
  elsif p_type in ('integer','bigint','smallint') then return '1';
  elsif p_type = 'numeric' then return '1::numeric';
  elsif p_type = 'date' then return 'current_date';
  elsif p_type like 'timestamp%' then return '(now() + interval ''1 day'')';
  elsif p_type like 'time%' then return '''09:00''::time';
  else return 'null::' || p_type;
  end if;
end $$;

create or replace function pg_temp.st_run(p_who text)
returns table(who text, kind text, name text, outcome text, detail text)
language plpgsql as $fn$
declare
  res text[] := '{}';
  v_role text := case when p_who = 'anon' then 'anon' else 'authenticated' end;
  v_att uuid; v_att2 uuid; v_victim uuid;
  c jsonb;
  v_tokens text[];
  v_base jsonb := '{}';
  v_claims text;
  v_statok boolean := false;
  r record; t record;
  v_args text; v_sql text; v_out text; v_before jsonb; v_after jsonb;
  v_changed text; v_state text; v_err text; v_n bigint; v_m bigint; v_d bigint; v_col text;
  v_flag text; v_tok text; v_me_before text; v_me_after text;
  -- Tables only an admin (or the server) may change.
  admin_only text[] := array['app_settings','admin_audit_log','agent_billing_plans','agent_billing_tiers',
    'billing_price_book','billing_settings','book_settings','commission_schedule','doc_settings',
    'fulfillment_pay','fulfillment_pay_runs','fulfillment_payouts','fulfillment_payout_accounts',
    'ghl_settings','lead_prices','lead_split_rules','licence_settings','membership_tiers',
    'payment_settings','price_book','profiles','recovery_config','rep_invites','secrets',
    'ai_caller_settings','deedstone_numbers','deedstone_number_vas','lead_spend_ledger',
    'agent_lead_spend','agent_inbound_spend','state_call_rules','carriers','training_videos'];
  -- Shared reference lists every signed-in person may read.
  reference text[] := array['carriers','notification_types','state_call_rules','commission_schedule',
    'training_videos','agent_billing_tiers','membership_tiers','prepaid_topup_options',
    'ai_consent_versions','sms_consent_scripts','doc_templates','billing_price_book','lead_prices',
    -- one-row settings every signed-in person reads (no secrets in them; see Security Check.md)
    'app_settings','billing_settings','book_settings','doc_settings','licence_settings',
    'payment_settings','recovery_config'];
begin
  begin -- everything below is rolled back at the end
    -- 1. The attacker ------------------------------------------------------
    if p_who = 'stranger' then
      v_att := gen_random_uuid(); v_att2 := gen_random_uuid();
      insert into public.pending_signups (email, role, source, terms_version, terms_accepted_at)
      values ('p922-a-' || v_att || '@example.invalid', 'agent', 'self', 'p922', now()),
             ('p922-b-' || v_att2 || '@example.invalid', 'agent', 'self', 'p922', now());
      insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                              created_at, updated_at, email_confirmed_at)
      values ('00000000-0000-0000-0000-000000000000', v_att, 'authenticated', 'authenticated',
              'p922-a-' || v_att || '@example.invalid',
              '{"provider":"email","providers":["email"],"role":"agent"}',
              '{"full_name":"P922 Stranger A","role":"admin"}', now(), now(), now()),
             ('00000000-0000-0000-0000-000000000000', v_att2, 'authenticated', 'authenticated',
              'p922-b-' || v_att2 || '@example.invalid',
              '{"provider":"email","providers":["email"],"role":"agent"}',
              '{"full_name":"P922 Stranger B"}', now(), now(), now());
      select concat_ws(' ', role, signup_source) into v_out from public.profiles where id = v_att;
      res := res || format('%s|signup|self sign-up makes|%s|%s', p_who,
        case when v_out = 'agent self' then 'ok' else 'FAIL escalate' end, v_out);
      -- Sign-up that asks for admin (user data or app data) or skips the sign-up step.
      foreach v_tok in array array['{"role":"admin"}|{}', '{}|{"role":"admin"}', '{}|{"role":"fulfillment"}', '{}|{}'] loop
        begin
          insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
          values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
                  'p922-x-' || md5(v_tok) || '@example.invalid',
                  split_part(v_tok, '|', 2)::jsonb, split_part(v_tok, '|', 1)::jsonb, now(), now());
          -- app_metadata can only be written with the server key (the invite path),
          -- so a VA account from app role 'fulfillment' is expected; anything else is not.
          res := res || format('%s|signup|user %s app %s|%s|account made', p_who,
                               split_part(v_tok, '|', 1), split_part(v_tok, '|', 2),
                               case when v_tok = '{}|{"role":"fulfillment"}' then 'ok (server-key invite path)' else 'FAIL escalate' end);
        exception when others then
          res := res || format('%s|signup|user %s app %s|ok|refused %s', p_who,
                               split_part(v_tok, '|', 1), split_part(v_tok, '|', 2), sqlstate);
        end;
      end loop;
    elsif p_who = 'agent' then
      select id into v_victim from public.profiles where role = 'agent' and is_active
        order by (select count(*) from public.policies x where x.agent_id = profiles.id) desc limit 1;
      select id into v_att from public.profiles where role = 'agent' and is_active and id <> v_victim
        order by (select count(*) from public.policies x where x.agent_id = profiles.id) desc limit 1;
    elsif p_who = 'va' then
      select id into v_att from public.profiles where role = 'fulfillment' and is_active
        order by (full_name ilike 'test%') desc, full_name limit 1;
    end if;

    -- 2. The victim and their things ---------------------------------------
    if v_victim is null then
      select x.agent_id into v_victim from public.policies x
       where x.agent_id is distinct from v_att group by 1 order by count(*) desc limit 1;
    end if;
    c := jsonb_build_object(
      'att', v_att, 'victim', v_victim,
      'va', (select id from public.profiles where role = 'fulfillment' and id is distinct from v_att order by full_name limit 1),
      'policy', (select id from public.policies where agent_id = v_victim order by created_at limit 1),
      'policies', '{' || (select string_agg(id::text, ',') from (select id from public.policies where agent_id = v_victim limit 5) s) || '}',
      'task', (select id from public.servicing_tasks where agent_id = v_victim limit 1),
      'lead', (select id from public.leads limit 1),
      'notifs', '{' || coalesce((select string_agg(id::text, ',') from (select id from public.notifications where profile_id = v_victim limit 5) s), '') || '}',
      'phone', (select client_phone from public.policies where agent_id = v_victim and client_phone is not null limit 1),
      'tier', (select key from public.agent_billing_tiers order by sort_order desc limit 1));
    -- Any-row lookups for the rarer ID kinds.
    foreach v_tok in array array['item:va_lines:queue_item','doc:policy_documents:id','send:doc_sends:id',
      'review:licence_reviews:id','intake:payment_intake_emails:id','check:carrier_portal_checks:id',
      'line:va_lines:id','request:va_day_off_requests:id','number:deedstone_numbers:id',
      'carrier:carriers:id','template:doc_templates:id'] loop
      begin
        execute format('select %I::text from public.%I where %I is not null limit 1',
          split_part(v_tok, ':', 3), split_part(v_tok, ':', 2), split_part(v_tok, ':', 3)) into v_out;
      exception when others then v_out := null; end;
      c := c || jsonb_build_object(split_part(v_tok, ':', 1), coalesce(v_out, gen_random_uuid()::text));
    end loop;

    -- What must never show up in an answer to this attacker.
    select array_agg(distinct x) into v_tokens from (
      select v_victim::text x
      union all select id::text from public.policies where agent_id = v_victim
      union all select id::text from public.servicing_tasks where agent_id = v_victim
      union all select id::text from public.leads
      union all select id::text from public.notifications where profile_id = v_victim
      union all select client_phone from public.policies where agent_id = v_victim and length(client_phone) >= 7
      union all select client_last_name from public.policies where agent_id = v_victim and length(client_last_name) >= 4
      union all select phone from public.leads where length(phone) >= 7
      union all select v_att2::text) s where x is not null;

    v_claims := case when v_att is null then '{"role":"anon"}'
      else json_build_object('sub', v_att, 'role', 'authenticated', 'aud', 'authenticated')::text end;
    res := res || format('%s|setup|attacker %s victim %s|info|%s tokens', p_who, coalesce(v_att::text, 'anon'), v_victim, coalesce(array_length(v_tokens, 1), 0));

    -- Base fingerprints: every table, rows that aren't the attacker's.
    for t in select c2.relname from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace
              where n.nspname = 'public' and c2.relkind in ('r', 'p') loop
      v_base := v_base || jsonb_build_object(t.relname, pg_temp.st_hash(t.relname, v_att::text));
    end loop;

    -- Self-check: does the per-transaction write counter see a write inside a sub-block?
    begin
      v_before := pg_temp.st_snap();
      update public.carriers x set name = x.name where x.id = (select id from public.carriers limit 1);
      v_after := pg_temp.st_snap();
      v_statok := coalesce((v_after->>'carriers')::bigint, 0) > coalesce((v_before->>'carriers')::bigint, 0);
      raise exception using errcode = 'P0922';
    exception when sqlstate 'P0922' then null; end;
    res := res || format('%s|setup|write counter|info|%s', p_who, case when v_statok then 'per-call counter' else 'hashing every table per call' end);

    -- 3. Every function the API exposes to this role --------------------------
    for r in
      select p.oid, p.proname, p.pronargs, p.proargnames, p.proargtypes, p.prosecdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
         and has_function_privilege(v_role, p.oid, 'execute')
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       order by p.proname
    loop
      v_args := '';
      for i in 1 .. r.pronargs loop
        v_args := v_args || case when i > 1 then ', ' else '' end
          || pg_temp.st_arg(r.proargnames[i], format_type(r.proargtypes[i - 1], null), c);
      end loop;
      v_sql := format('select left(coalesce(string_agg(x::text, %L), %L), 2000) from public.%I(%s) x', ' ;; ', '<null>', r.proname, v_args);
      v_changed := ''; v_out := null; v_state := null;
      begin
        v_before := pg_temp.st_snap();
        execute 'set local role ' || v_role;
        perform set_config('request.jwt.claims', v_claims, true);
        perform set_config('request.jwt.claim.sub', coalesce(v_att::text, ''), true);
        execute v_sql into v_out;
        execute 'reset role';
        v_after := pg_temp.st_snap();
        for t in select k from jsonb_object_keys(v_base) k loop
          if (not v_statok or coalesce((v_after->>t.k)::bigint, 0) > coalesce((v_before->>t.k)::bigint, 0))
             and pg_temp.st_hash(t.k, v_att::text) is distinct from v_base->>t.k then
            v_changed := v_changed || t.k || ' ';
          end if;
        end loop;
        raise exception using errcode = 'P0922', message = coalesce(v_out, ''), detail = v_changed;
      exception
        when sqlstate 'P0922' then
          get stacked diagnostics v_out = message_text, v_changed = pg_exception_detail;
          v_state := 'ran';
        when others then
          get stacked diagnostics v_state = returned_sqlstate, v_err = message_text;
          v_out := v_err;
      end;
      v_flag := 'ok';
      if v_state = 'ran' then
        if p_who = 'va' then
          if exists (select 1 from unnest(string_to_array(trim(v_changed), ' ')) z where z = any(admin_only)) then
            v_flag := 'FAIL write';
          elsif r.proname like 'admin\_%' then v_flag := 'REVIEW ran';
          end if;
        else
          if trim(v_changed) <> '' then v_flag := 'FAIL write';
          elsif exists (select 1 from unnest(v_tokens) z where position(z in v_out) > 0) then v_flag := 'FAIL leak';
          elsif r.proname ~ '^(admin_|va_|fulfillment_)' and v_out not in ('', '<null>', '[]', '{}', 'f', '0', '()')
                and v_out !~ '^[ ;]*$' then v_flag := 'REVIEW ran';
          end if;
        end if;
      elsif v_state = '42501' or v_out ~* 'not allowed|permission denied|not authori|admin only|sign in|forbidden|only (an )?admin' then
        v_flag := 'ok';
      else
        v_flag := 'REVIEW other';
      end if;
      res := res || format('%s|fn%s|%s|%s %s|%s %s', p_who, case when r.prosecdef then '' else '(invoker)' end,
        r.proname, v_flag, coalesce(v_state, ''), left(replace(coalesce(v_out, ''), '|', '/'), 300),
        case when trim(v_changed) <> '' then '[changed: ' || trim(v_changed) || ']' else '' end);
    end loop;

    -- 4. Every table and view: read, no-op update, delete ---------------------
    for t in select c2.relname, c2.relkind from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace
              where n.nspname = 'public' and c2.relkind in ('r', 'p', 'v', 'm') order by 1 loop
      v_n := null; v_m := null; v_state := null; v_out := '';
      -- read
      begin
        execute 'set local role ' || v_role;
        perform set_config('request.jwt.claims', v_claims, true);
        execute format('select count(*) from public.%I x where %L = %L or position(%L in x::text) = 0',
                       t.relname, coalesce(v_att::text, ''), '', coalesce(v_att::text, '')) into v_n;
        raise exception using errcode = 'P0922', message = v_n::text;
      exception when sqlstate 'P0922' then v_n := sqlerrm::bigint;
                when others then v_n := null; v_out := sqlstate;
      end;
      -- update (no-op on the first plain column) and delete, rows that aren't the attacker's
      select a.attname into v_col from pg_attribute a where a.attrelid = ('public.' || quote_ident(t.relname))::regclass
         and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = '' order by a.attnum limit 1;
      v_m := 0; v_d := 0;
      if t.relkind in ('r', 'p') then
        begin
          execute 'set local role ' || v_role;
          perform set_config('request.jwt.claims', v_claims, true);
          execute format('update public.%I x set %I = %I where %L = %L or position(%L in x::text) = 0',
                         t.relname, v_col, v_col, coalesce(v_att::text, ''), '', coalesce(v_att::text, ''));
          get diagnostics v_m = row_count;
          raise exception using errcode = 'P0922', message = v_m::text;
        exception when sqlstate 'P0922' then v_m := sqlerrm::bigint; when others then v_m := 0; end;
        begin
          execute 'set local role ' || v_role;
          perform set_config('request.jwt.claims', v_claims, true);
          execute format('delete from public.%I x where %L = %L or position(%L in x::text) = 0',
                         t.relname, coalesce(v_att::text, ''), '', coalesce(v_att::text, ''));
          get diagnostics v_d = row_count;
          raise exception using errcode = 'P0922', message = v_d::text;
        exception when sqlstate 'P0922' then v_d := sqlerrm::bigint; when others then v_d := 0; end;
      end if;
      v_flag := 'ok';
      if v_m > 0 or v_d > 0 then
        v_flag := case when p_who = 'va' and not (t.relname = any(admin_only)) then 'REVIEW write' else 'FAIL write' end;
      elsif coalesce(v_n, 0) > 0 and not (t.relname = any(reference)) then
        v_flag := 'REVIEW read';
      end if;
      res := res || format('%s|table|%s|%s|foreign rows read %s, updated %s, deleted %s%s', p_who, t.relname, v_flag,
        coalesce(v_n::text, 'no ' || v_out), v_m, v_d, '');
    end loop;

    -- 5. Storage ------------------------------------------------------------
    for t in select id, public from storage.buckets order by id loop
      begin
        execute 'set local role ' || v_role;
        perform set_config('request.jwt.claims', v_claims, true);
        select count(*) into v_n from storage.objects o where o.bucket_id = t.id
           and (v_att is null or position(v_att::text in o.name) = 0);
        raise exception using errcode = 'P0922', message = v_n::text;
      exception when sqlstate 'P0922' then v_n := sqlerrm::bigint; when others then v_n := -1; end;
      begin
        execute 'set local role ' || v_role;
        perform set_config('request.jwt.claims', v_claims, true);
        insert into storage.objects (bucket_id, name, owner, owner_id)
        values (t.id, v_victim || '/p922-probe.txt', v_att, v_att::text);
        raise exception using errcode = 'P0922', message = 'uploaded';
      exception when sqlstate 'P0922' then v_out := 'uploaded'; when others then v_out := 'refused ' || sqlstate; end;
      begin
        execute 'set local role ' || v_role;
        perform set_config('request.jwt.claims', v_claims, true);
        delete from storage.objects o where o.bucket_id = t.id and (v_att is null or position(v_att::text in o.name) = 0);
        get diagnostics v_m = row_count;
        raise exception using errcode = 'P0922', message = v_m::text;
      exception when sqlstate 'P0922' then v_m := sqlerrm::bigint; when others then v_m := 0; end;
      v_flag := case when v_out = 'uploaded' or v_m > 0 then 'FAIL write'
                     when v_n > 0 and not t.public then 'FAIL leak'
                     when v_n > 0 then 'REVIEW read' else 'ok' end;
      res := res || format('%s|storage|%s%s|%s|others'' files listed %s; upload into victim folder: %s; deleted %s',
        p_who, t.id, case when t.public then ' (public)' else '' end, v_flag, v_n, v_out, v_m);
    end loop;

    -- 6. Escalation on its own profile ---------------------------------------
    if v_att is not null then
      for t in select x.label, x.stmt from (values
          ('role admin',            'update public.profiles set role = ''admin'' where id = %L'),
          ('role fulfillment',      'update public.profiles set role = ''fulfillment'' where id = %L'),
          ('signup source invite',  'update public.profiles set signup_source = ''invite'' where id = %L'),
          ('own insert as admin',   'insert into public.profiles (id, email, role) values (gen_random_uuid(), ''p922z@example.invalid'', ''admin'') returning %L'),
          ('rpc role admin (self)', 'select public.admin_set_user_role(%L, ''admin'', true)'),
          ('rpc access (self)',     'select public.admin_set_user_access(%L, true, true)')
        ) x(label, stmt) loop
        begin
          execute 'set local role ' || v_role;
          perform set_config('request.jwt.claims', v_claims, true);
          execute 'reset role';
          select md5((to_jsonb(x) - 'updated_at')::text) into v_me_before from public.profiles x where x.id = v_att; -- updated_at is stamped by a trigger on every update
          execute 'set local role ' || v_role;
          execute format(t.stmt, v_att);
          get diagnostics v_m = row_count;
          execute 'reset role';
          select md5((to_jsonb(x) - 'updated_at')::text) into v_me_after from public.profiles x where x.id = v_att;
          raise exception using errcode = 'P0922', message = v_m::text,
            detail = case when v_me_before is distinct from v_me_after
                            or (select count(*) from public.profiles where role = 'admin') <> (select count(*) from public.profiles where role = 'admin' and id <> v_att)
                          then 'changed' else 'same' end;
        exception when sqlstate 'P0922' then
                    get stacked diagnostics v_changed = pg_exception_detail;
                    v_out := 'rows ' || sqlerrm || ', profile ' || v_changed;
                  when others then v_out := 'refused ' || sqlstate;
        end;
        -- A no-op (setting a value it already has) changes nothing and isn't an escalation.
        res := res || format('%s|escalate|%s|%s|%s', p_who, t.label,
          case when v_out like '%profile changed' or (t.label = 'own insert as admin' and v_out like 'rows 1%') then 'FAIL escalate' else 'ok' end, v_out);
      end loop;
      -- Flip every true/false column on its own profile, one at a time.
      for t in select a.attname from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attnum > 0
                 and not a.attisdropped and a.atttypid = 'boolean'::regtype order by 1 loop
        begin
          execute 'set local role ' || v_role;
          perform set_config('request.jwt.claims', v_claims, true);
          execute format('update public.profiles set %I = not coalesce(%I, false) where id = %L', t.attname, t.attname, v_att);
          get diagnostics v_m = row_count;
          raise exception using errcode = 'P0922', message = v_m::text;
        exception when sqlstate 'P0922' then v_out := 'rows ' || sqlerrm;
                  when others then v_out := 'refused ' || sqlstate;
        end;
        res := res || format('%s|escalate|profiles.%s flip|%s|%s', p_who, t.attname,
          case when v_out like 'rows %' and v_out <> 'rows 0' then 'REVIEW self-write' else 'ok' end, v_out);
      end loop;
    end if;

    raise exception using errcode = 'P0922'; -- roll everything back
  exception when sqlstate 'P0922' then null;
  end;
  return query select split_part(x, '|', 1), split_part(x, '|', 2), split_part(x, '|', 3),
                      split_part(x, '|', 4), split_part(x, '|', 5) from unnest(res) x;
end $fn$;
