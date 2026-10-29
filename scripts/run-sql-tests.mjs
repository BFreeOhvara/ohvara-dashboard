// run-sql-tests: the database safety tests (supabase/tests/*.sql) on this computer.
//
//   npm run test:sql                 every supabase/tests/*.sql, alphabetical
//   npm run test:sql -- <path>       one .sql file, or a folder of them
//   node scripts/run-sql-tests.mjs <path>
//
// LOCAL AND IN-MEMORY ONLY. It starts PGlite (Postgres compiled to WASM) inside
// this node process. There is no database URL, no key, no network: it cannot
// reach Ohvara's live database. Nothing is written to disk and nothing on disk
// is changed; migration and test files are only read.
//
// What it does, in order:
//   1. Builds the Supabase stand-in (the SUPABASE STAND-IN section below):
//      roles, grants, the auth / storage / cron / net / vault schemas and the
//      functions migrations call, so files written for Supabase load here.
//   2. Replays supabase/migrations/*.sql in filename order, each file in its
//      own transaction (a failure rolls back only that file; the enum ADD VALUE
//      migrations need the earlier file committed before a later one uses the
//      value, which one outer transaction with savepoints would not give).
//      `create extension` for an extension PGlite can't load (pg_net, pg_cron)
//      is rewritten to a no-op in memory and logged with file and line; the
//      stand-in supplies the functions those extensions would have made.
//      Then pgTAP is installed in the extensions schema, as on a Supabase
//      test stack, so a file can call plan() without creating it.
//   3. Role/RLS self-check: proves `set role authenticated` plus
//      request.jwt.claims gives auth.uid() and that RLS hides another user's
//      row. If it can't, it prints BLOCKER, runs no test and exits 1.
//   4. Runs each test file as written, statement by statement, on a fresh clone
//      of the replayed database (no outer transaction: the files carry their
//      own begin/rollback). Reads pgTAP output (plan 1..N, ok / not ok) and the
//      'XXX RESULTS (N failed):' error-text style. One PASS/FAIL line per file.
//   5. Ends with the replay failures: ROOT CAUSES first (exact SQLSTATE and
//      message), then KNOCK-ONS grouped under the root they trace to. A
//      knock-on is a missing-object error (42P01, 42883, 42704, 3F000, 42703)
//      whose object an earlier failed file creates or changes (its DDL names
//      an object of that kind: create table/function/type, add column,
//      rename to, ...); anything else is a root cause. Every replay failure
//      gets a line number (run-time errors: the failed file is re-run
//      statement by statement, rolled back, to find it).
//
// Exit code: 0 only when the self-check passes and every test file passes.
// Any failing check, plan mismatch, unparseable output or crash exits 1.
// Replay failures alone don't fail the run; a test that needs a failed
// migration fails with that reason.
//
// Extending the stand-in: when a migration needs something Supabase provides
// (a role, an auth.* column, a storage or cron function), add it to
// SUPABASE_STANDIN below, matching Supabase's real definition. When a
// migration creates another extension PGlite lacks, nothing to do: any name
// not in pg_available_extensions is rewritten and logged. An extension PGlite
// ships (pglite.dev/extensions) goes in EXTENSIONS instead, so it loads for real.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { pgtap } from '@electric-sql/pglite-pgtap'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const target = resolve(process.argv[2] ?? join(ROOT, 'supabase', 'tests'))

// Extensions loaded for real (Supabase has them in the extensions schema).
const EXTENSIONS = { pgcrypto, uuid_ossp, pgtap }
// Replay files Vera found failing on master (Oct 29): always reported by name.
const WATCH = ['091', '162']
// Missing-object SQLSTATEs that can be a knock-on of an earlier failed file.
const MISSING = new Set(['42P01', '42883', '42704', '3F000', '42703'])

// ── SUPABASE STAND-IN ───────────────────────────────────────────────────────
// Just enough of a Supabase project for the migrations and tests: the API
// roles and their default grants, auth (users, identities, sessions,
// refresh_tokens, uid/role/jwt/email), storage (buckets, objects, foldername),
// cron and net as inert tables (cron.schedule records the job, net.http_post
// queues the request in net.http_request_queue; nothing runs and nothing is
// sent), vault (secrets in plain text, it's a throwaway database) and the
// supabase_realtime publication. Definitions follow Supabase's own.
const SUPABASE_STANDIN = String.raw`
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin superuser; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists cron;
create schema if not exists net;
create schema if not exists vault;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

do $$ begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;
set search_path = "$user", public, extensions;

grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;
grant all on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- auth
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text unique default null,
  phone_confirmed_at timestamptz,
  phone_change text default '',
  phone_change_token varchar(255) default '',
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default '',
  email_change_confirm_status smallint default 0,
  banned_until timestamptz,
  reauthentication_token varchar(255) default '',
  reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);
create table auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid primary key default gen_random_uuid(),
  unique (provider_id, provider)
);
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz,
  updated_at timestamptz,
  not_after timestamptz
);
create table auth.refresh_tokens (
  instance_id uuid,
  id bigserial primary key,
  token varchar(255) unique,
  user_id varchar(255),
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  parent varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
$$;
create function auth.email() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;

-- storage
create table storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  owner_id text,
  user_metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
create function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;
create function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end $$;

-- cron (pg_cron's tables and functions; jobs are recorded, never run)
create table cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  nodename text not null default 'localhost',
  nodeport integer not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true,
  jobname text
);
create table cron.job_run_details (
  jobid bigint,
  runid bigserial primary key,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$
declare v bigint;
begin
  update cron.job set schedule = $2, command = $3 where jobname = $1 and username = current_user returning jobid into v;
  if v is null then
    insert into cron.job (schedule, command, jobname) values ($2, $3, $1) returning jobid into v;
  end if;
  return v;
end $$;
create function cron.schedule(schedule text, command text) returns bigint language sql as $$
  insert into cron.job (schedule, command) values ($1, $2) returning jobid
$$;
create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobid = job_id;
  if not found then raise exception 'could not find valid entry for job %', job_id; end if;
  return true;
end $$;
create function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = job_name and username = current_user;
  if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
  return true;
end $$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
                               database text default null, username text default null, active boolean default null)
returns void language sql as $$
  update cron.job set schedule = coalesce($2, cron.job.schedule), command = coalesce($3, cron.job.command),
         active = coalesce($6, cron.job.active) where jobid = $1
$$;

-- net (pg_net's signatures; requests are queued in a table, never sent)
create table net.http_request_queue (
  id bigserial primary key,
  method text not null,
  url text not null,
  headers jsonb,
  body jsonb,
  timeout_milliseconds integer
);
create table net._http_response (
  id bigint,
  status_code integer,
  content_type text,
  headers jsonb,
  content text,
  timed_out boolean,
  error_msg text,
  created timestamptz not null default now()
);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                              headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
                              timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  values ('POST', url, headers, body, timeout_milliseconds) returning id
$$;
create function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
                             timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.http_request_queue (method, url, headers, timeout_milliseconds)
  values ('GET', url, headers, timeout_milliseconds) returning id
$$;
create function net.http_delete(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
                                timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.http_request_queue (method, url, headers, timeout_milliseconds)
  values ('DELETE', url, headers, timeout_milliseconds) returning id
$$;

-- vault (plain text here; Supabase encrypts)
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  key_id uuid,
  nonce bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, key_id, nonce, created_at, updated_at
    from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null,
                                    new_description text default '', new_key_id uuid default null)
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description, key_id)
  values (new_secret, new_name, new_description, new_key_id) returning id
$$;

-- realtime
create publication supabase_realtime;
`
// ── end of the stand-in ─────────────────────────────────────────────────────

// SQL scanner: the spans that aren't code (comments, quoted strings, dollar
// bodies) and the top-level statements (split on ; outside those spans).
function scanSql(text) {
  const spans = []
  const stmts = []
  const n = text.length
  let i = 0
  let start = 0
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === '-' && d === '-') {
      const e = text.indexOf('\n', i)
      const end = e < 0 ? n : e
      spans.push({ start: i, end, kind: 'comment' })
      i = end
    } else if (c === '/' && d === '*') {
      let depth = 1
      let j = i + 2
      while (j < n && depth) {
        if (text[j] === '/' && text[j + 1] === '*') { depth++; j += 2 }
        else if (text[j] === '*' && text[j + 1] === '/') { depth--; j += 2 }
        else j++
      }
      spans.push({ start: i, end: j, kind: 'comment' })
      i = j
    } else if (c === "'") {
      const escapes = /[eE]/.test(text[i - 1] ?? '') && !/[\w$]/.test(text[i - 2] ?? '')
      let j = i + 1
      while (j < n) {
        if (escapes && text[j] === '\\') { j += 2; continue }
        if (text[j] === "'") {
          if (text[j + 1] === "'") { j += 2; continue }
          j++
          break
        }
        j++
      }
      spans.push({ start: i, end: j, kind: 'string' })
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < n && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1
      i = j + 1
    } else if (c === '$' && !/[\w$]/.test(text[i - 1] ?? '') && /^\$([A-Za-z_]\w*)?\$/.test(text.slice(i, i + 64))) {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(text.slice(i, i + 64))[0]
      const e = text.indexOf(tag, i + tag.length)
      const end = e < 0 ? n : e + tag.length
      spans.push({ start: i, end, kind: 'dollar' })
      i = end
    } else {
      if (c === ';') {
        stmts.push({ start, end: i + 1 })
        start = i + 1
      }
      i++
    }
  }
  if (start < n) stmts.push({ start, end: n })
  return { spans, stmts }
}

// Same-length copy with the chosen span kinds blanked (newlines kept).
function mask(text, spans, kinds) {
  const out = text.split('')
  for (const s of spans) {
    if (!kinds.includes(s.kind)) continue
    for (let k = s.start; k < s.end; k++) if (out[k] !== '\n') out[k] = ' '
  }
  return out.join('')
}

const lineAt = (text, offset) => text.slice(0, offset).split('\n').length

// create extension for anything PGlite can't load → `select null`, padded so
// every later line keeps its number. Returns the new text and the log.
function rewriteExtensions(file, text, available) {
  const { spans } = scanSql(text)
  const code = mask(text, spans, ['comment', 'string', 'dollar'])
  const re = /\bcreate\s+extension\s+(?:if\s+not\s+exists\s+)?("?)([\w-]+)\1[^;]*/gi
  const rewrites = []
  const notes = []
  let out = text
  for (const m of [...code.matchAll(re)].reverse()) {
    const ext = m[2].toLowerCase()
    if (available.has(ext)) continue
    const original = text.slice(m.index, m.index + m[0].length)
    const pad = '\n'.repeat(original.split('\n').length - 1)
    out = out.slice(0, m.index) + 'select null' + pad + out.slice(m.index + m[0].length)
    rewrites.unshift({ file, line: lineAt(text, m.index), ext, original: original.replace(/\s+/g, ' ').trim() })
  }
  // A create extension inside a function or DO body runs only when called: leave it, but say so.
  const bodies = spans.filter(s => s.kind === 'dollar')
  for (const m of mask(text, spans, ['comment', 'string']).matchAll(re)) {
    if (!available.has(m[2].toLowerCase()) && bodies.some(s => m.index > s.start && m.index < s.end)) {
      notes.push({ file, line: lineAt(text, m.index), ext: m[2].toLowerCase() })
    }
  }
  return { text: out, rewrites, notes }
}

const errInfo = (e, text, offset = 0) => ({
  sqlstate: e.code ?? 'no SQLSTATE',
  message: e.message ?? String(e),
  line: e.position && text != null ? lineAt(text, offset + Number(e.position) - 1) : null,
  detail: e.detail || null,
  where: e.where || null,
})

// The object a missing-object error names: { kind, name } (name without its schema).
function missingObject(message) {
  const pats = [
    ['column', /column "([^"]+)" of relation "[^"]+" does not exist/],
    ['column', /record "[^"]+" has no field "([^"]+)"/],
    ['column', /column (?:"?\w+"?\.)+"?(\w+)"? does not exist/],
    ['column', /column "([^"]+)" does not exist/],
    ['function', /function ([\w."]+)\(/],
    ['relation', /relation "([^"]+)" does not exist/],
    ['type', /type "([^"]+)" does not exist/],
    ['schema', /schema "([^"]+)" does not exist/],
    ['role', /role "([^"]+)" does not exist/],
    ['index', /index "([^"]+)" does not exist/],
    ['constraint', /constraint "([^"]+)"/],
    ['trigger', /trigger "([^"]+)"/],
    ['policy', /policy "([^"]+)"/],
  ]
  for (const [kind, re] of pats) {
    const m = re.exec(message)
    if (m) return { kind, name: m[1].replaceAll('"', '').split('.').pop().toLowerCase() }
  }
  return null
}

// DDL that creates or changes an object of this kind and name (optionally schema-qualified, optionally quoted).
function ddlFor({ kind, name }) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const q = `(?:"?\\w+"?\\.)?"?${esc}"?(?![\\w"])`
  const renamed = `rename\\s+(?:column\\s+\\S+\\s+)?to\\s+${q}`
  const src = {
    relation: `create\\s+(?:or\\s+replace\\s+)?(?:(?:temp|temporary|unlogged)\\s+)?(?:table|view|materialized\\s+view|sequence)\\s+(?:if\\s+not\\s+exists\\s+)?${q}|${renamed}`,
    function: `create\\s+(?:or\\s+replace\\s+)?(?:function|procedure)\\s+${q}\\s*\\(|${renamed}`,
    type: `create\\s+(?:type|domain)\\s+${q}|${renamed}`,
    schema: `create\\s+schema\\s+(?:if\\s+not\\s+exists\\s+)?${q}`,
    column: `add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?${q}|${renamed}|^[ \\t(]*${q}[ \\t]+\\w`,
    role: `create\\s+(?:role|user)\\s+${q}`,
    index: `create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?${q}`,
    constraint: `constraint\\s+${q}`,
    trigger: `create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+${q}`,
    policy: `create\\s+policy\\s+${q}`,
  }[kind]
  return new RegExp(src, 'im')
}

// A missing-object error whose object an earlier failed file creates or
// changes → { via, root } (via: the latest such file); otherwise null (a root cause).
function traceFailure(sqlstate, message, earlier) {
  if (!MISSING.has(sqlstate)) return null
  const obj = missingObject(message)
  if (!obj) return null
  const re = ddlFor(obj)
  const via = [...earlier].reverse().find(f => re.test(f.body))
  return via ? { via, root: via.root ?? via } : null
}

// Run-time errors carry no position: re-run the failed file statement by
// statement (rolled back) to find the line of the statement that fails.
async function failingLine(db, text) {
  const { spans, stmts } = scanSql(text)
  const code = mask(text, spans, ['comment'])
  await db.exec('begin')
  try {
    for (const s of stmts) {
      const lead = code.slice(s.start, s.end).search(/[^\s;]/)
      if (lead < 0) continue
      try {
        await db.exec(text.slice(s.start, s.end))
      } catch (e) {
        return lineAt(text, s.start + (e.position ? Number(e.position) - 1 : lead))
      }
    }
    return null
  } finally {
    await db.exec('rollback')
  }
}

async function replay(db, available) {
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  const failures = []
  const rewrites = []
  const notes = []
  for (const file of files) {
    const raw = readFileSync(join(MIGRATIONS, file), 'utf8')
    const r = rewriteExtensions(file, raw, available)
    rewrites.push(...r.rewrites)
    notes.push(...r.notes)
    await db.exec('begin')
    try {
      await db.exec(r.text)
      await db.exec('commit')
    } catch (e) {
      await db.exec('rollback')
      const f = { file, ...errInfo(e, r.text), body: mask(raw, scanSql(raw).spans, ['comment']) }
      f.line ??= await failingLine(db, r.text)
      const t = traceFailure(f.sqlstate, f.message, failures)
      if (t) Object.assign(f, { via: t.via, root: t.root })
      failures.push(f)
    }
  }
  return { files, failures, rewrites, notes }
}

// Cheap fingerprint: catalog counts plus the row count of every table outside pg_catalog.
async function fingerprint(db) {
  const cat = (await db.query(`select (select count(*) from pg_class)::int as rel, (select count(*) from pg_proc)::int as fn,
                                      (select count(*) from pg_policy)::int as pol, (select count(*) from pg_trigger)::int as trg`)).rows[0]
  const q = (await db.query(`select string_agg(format('select count(*) as c from %I.%I', n.nspname, c.relname), ' union all ') as q
                               from pg_class c join pg_namespace n on n.oid = c.relnamespace
                              where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema')
                                and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'`)).rows[0].q
  const rows = q ? (await db.query(`select sum(c)::bigint as n from (${q}) t`)).rows[0].n : 0
  return `relations ${cat.rel}, functions ${cat.fn}, policies ${cat.pol}, triggers ${cat.trg}, rows ${rows}`
}


// Role/RLS self-check on a throwaway clone. Returns { ok, line }.
async function selfCheck(base) {
  const me = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const db = await base.clone()
  try {
    await db.exec(`set search_path = "$user", public, extensions;
      begin;
      create temp table rls_selfcheck (owner uuid not null, note text);
      insert into rls_selfcheck values ('${me}', 'mine'), ('${other}', 'theirs');
      alter table rls_selfcheck enable row level security;
      create policy own_rows on rls_selfcheck for all using (owner = auth.uid()) with check (owner = auth.uid());
      grant select, insert on rls_selfcheck to authenticated;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${me}","role":"authenticated"}', true);`)
    const r = (await db.query(`select current_user::text as who, auth.uid()::text as uid, auth.role() as role,
      (select coalesce(string_agg(owner::text, ',' order by note), '') from rls_selfcheck) as visible`)).rows[0]
    let insertErr = null
    try {
      await db.exec(`insert into rls_selfcheck values ('${other}', 'forged')`)
    } catch (e) {
      insertErr = e.code
    }
    await db.exec('rollback')
    const seen = r.visible ? r.visible.split(',') : []
    const problems = []
    if (r.who !== 'authenticated') problems.push(`current_user is ${r.who}, not authenticated (set role did not switch)`)
    if (r.uid !== me) problems.push(`auth.uid() returned ${r.uid ?? 'null'}, not the claimed ${me}`)
    if (!seen.includes(me)) problems.push("the owner's own row is not visible")
    if (seen.includes(other)) problems.push("another user's row is visible (RLS not enforced)")
    if (insertErr !== '42501') problems.push(`insert as another user was not refused with 42501 (got ${insertErr ?? 'no error'})`)
    if (db.isInTransaction()) problems.push('a transaction was still open after rollback')
    if (problems.length) return { ok: false, line: problems.join('; ') }
    return {
      ok: true,
      line: `under set role authenticated with request.jwt.claims {"sub":"${me}"}: current_user=${r.who}, `
        + `auth.uid()=${r.uid}, auth.role()=${r.role}; own row visible, other user's row blocked `
        + `(saw ${seen.length} of 2 rows); insert as the other user refused 42501`,
    }
  } catch (e) {
    return { ok: false, line: `self-check crashed: ${e.code ?? ''} ${e.message ?? e}` }
  } finally {
    await db.close()
  }
}

const TX_CONTROL = new Set(['rollback', 'commit', 'end', 'abort'])

// One test file on a fresh clone, statement by statement, as written.
async function runTestFile(base, path, baseFp, available, failures) {
  const name = basename(path)
  const raw = readFileSync(path, 'utf8')
  const { text, rewrites } = rewriteExtensions(name, raw, available)
  const out = { name, rewrites, checks: 0, failed: [], problems: [], isolation: '' }
  const db = await base.clone()
  try {
    await db.exec('set search_path = "$user", public, extensions')
    const fp = await fingerprint(db)
    const fresh = fp === baseFp
    if (!fresh) out.problems.push(`the clone did not match the replayed database (${fp} vs ${baseFp})`)

    const { spans, stmts } = scanSql(text)
    const code = mask(text, spans, ['comment'])
    const tap = []
    let error = null
    let notRun = 0
    for (const s of stmts) {
      const body = code.slice(s.start, s.end)
      const lead = body.search(/[^\s;]/)
      if (lead < 0) continue
      const kw = body.slice(lead).split(/[\s;]/)[0].toLowerCase()
      // After an error only the file's own rollback/commit runs; anything else would fail with 25P02.
      if (error && !TX_CONTROL.has(kw)) { notRun++; continue }
      try {
        for (const res of await db.exec(text.slice(s.start, s.end))) {
          for (const row of res.rows) for (const v of Object.values(row)) if (typeof v === 'string') tap.push(...v.split('\n'))
        }
      } catch (e) {
        if (!error) error = { ...errInfo(e, text, s.start), line: e.position ? lineAt(text, s.start + Number(e.position) - 1) : lineAt(text, s.start + lead) }
      }
    }
    const leftOpen = db.isInTransaction()
    if (leftOpen) await db.exec('rollback')
    out.isolation = `fresh clone of the replayed db (${fresh ? 'fingerprint matches' : 'FINGERPRINT DIFFERS'}); `
      + (leftOpen ? 'a transaction was left open after the file, runner rolled it back' : 'no transaction open after the file')
      + (db.isInTransaction() ? ' (STILL OPEN)' : '')

    const report = error && /^(.*?)\s*RESULTS \((\d+) failed\):?([\s\S]*)$/.exec(error.message)
    if (report) {
      // 'XXX RESULTS (N failed):' raised by the last statement: the error text is the report.
      const lines = report[3].split('\n').map(l => l.trim())
      const fail = lines.filter(l => /^FAIL\b/.test(l))
      out.style = 'RESULTS report'
      out.checks = lines.filter(l => /^PASS\b/.test(l)).length + fail.length
      out.failed = fail.map(l => l.replace(/^FAIL\s*/, ''))
      if (Number(report[2]) !== fail.length) out.problems.push(`the report says ${report[2]} failed but lists ${fail.length} FAIL line(s)`)
      if (!out.checks) out.problems.push('the report lists no PASS or FAIL lines')
      if (notRun) out.problems.push(`${notRun} statement(s) after the report not run`)
    } else {
      const plan = tap.map(l => /^1\.\.(\d+)/.exec(l)).find(Boolean)
      const results = tap.filter(l => /^(not )?ok \d+/.test(l))
      out.style = results.length || plan ? 'pgTAP' : null
      out.checks = results.length
      out.failed = results
        .filter(l => l.startsWith('not ok') && !/#\s*TODO/i.test(l))
        .map(l => l.replace(/^not ok \d+\s*-?\s*/, ''))
      if (error) {
        let why = `stopped at line ${error.line}: SQLSTATE ${error.sqlstate}: ${error.message}`
        const t = traceFailure(error.sqlstate, error.message, failures)
        if (t) why += `; can't run: it needs ${t.via.file}, which failed in the replay` + (t.root !== t.via ? ` (root cause ${t.root.file})` : '')
        out.problems.push(why)
        if (error.where) out.problems.push(`where: ${error.where.split('\n').join(' / ')}`)
        if (notRun) out.problems.push(`${notRun} statement(s) after it not run`)
      }
      if (!plan && !results.length && !error) out.problems.push('unparseable: no pgTAP output (no plan, no ok/not ok) and no RESULTS report')
      else if (!plan && results.length) out.problems.push('no plan (1..N) in the output')
      else if (plan && Number(plan[1]) !== results.length) out.problems.push(`plan mismatch: planned ${plan[1]}, ran ${results.length}`)
    }
  } catch (e) {
    out.problems.push(`runner crashed on this file: ${e.code ?? ''} ${e.message ?? e}`)
  } finally {
    await db.close()
  }
  out.pass = !out.failed.length && !out.problems.length
  return out
}

function testFiles() {
  if (statSync(target).isDirectory()) return readdirSync(target).filter(f => f.endsWith('.sql')).sort().map(f => join(target, f))
  if (target.endsWith('.sql')) return [target]
  throw new Error(`not a .sql file or a folder: ${target}`)
}

async function main() {
  const files = testFiles()
  const t0 = Date.now()
  const db = await PGlite.create({ extensions: EXTENSIONS })
  const version = (await db.query('select version() as v')).rows[0].v.split(' on ')[0]
  const available = new Set((await db.query('select name from pg_available_extensions')).rows.map(r => r.name))
  console.log(`run-sql-tests: ${version}, in memory in this process. No network, no database URL; files on disk are only read.`)
  console.log(`Extensions PGlite can load: ${[...available].sort().join(', ')}`)

  await db.exec(SUPABASE_STANDIN)
  const { files: migrations, failures, rewrites, notes } = await replay(db, available)
  const roots = failures.filter(f => !f.root)
  const knocks = failures.filter(f => f.root)

  console.log('\n== create extension rewrites (in memory only; the files on disk are not changed) ==')
  for (const r of rewrites) console.log(`  ${r.file}:${r.line}  ${r.ext}  \`${r.original}\` → select null`)
  for (const n of notes) console.log(`  NOTE ${n.file}:${n.line}  ${n.ext} inside a function/DO body, left as written (runs only when called)`)
  console.log(`  ${rewrites.length} rewrite(s)`)

  console.log('\n== Migration replay ==')
  console.log(`  ${migrations.length} files: ${migrations.length - failures.length} applied, ${failures.length} failed `
    + `(${roots.length} root cause(s), ${knocks.length} knock-on(s)); exact errors at the end`)
  // pgTAP for the tests, as on a Supabase test stack (after the replay, so no migration sees it).
  await db.exec('create extension if not exists pgtap with schema extensions')
  const baseFp = await fingerprint(db)
  console.log(`  replayed db (+ pgtap in extensions): ${baseFp}`)

  console.log('\n== Role/RLS self-check ==')
  const sc = await selfCheck(db)
  const results = []
  if (!sc.ok) {
    console.log(`  BLOCKER  ${sc.line}`)
    console.log('  PGlite cannot stand in for Supabase roles/RLS here, so no test is run and none is reported as passing.')
  } else {
    console.log(`  PASS  ${sc.line}`)
    console.log(`\n== Tests (${files.length} file(s) from ${target}) ==`)
    for (const path of files) {
      const r = await runTestFile(db, path, baseFp, available, failures)
      results.push(r)
      console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.checks} check(s) run, ${r.failed.length} failed  [${r.style ?? 'no output'}]`)
      for (const f of r.failed) console.log(`        not ok: ${f}`)
      for (const p of r.problems) console.log(`        ${p}`)
      for (const w of r.rewrites) console.log(`        rewrote create extension ${w.ext} at line ${w.line}`)
      console.log(`        isolation: ${r.isolation}`)
    }
    const endFp = await fingerprint(db)
    if (endFp !== baseFp) {
      console.log(`  FAIL  the replayed db changed during the tests (${baseFp} → ${endFp})`)
      results.push({ pass: false })
    }
  }

  const passed = results.filter(r => r.pass).length
  const code = sc.ok && results.length && passed === results.length ? 0 : 1
  console.log(`\nResult: ${sc.ok ? `${passed} of ${files.length} test file(s) passed` : 'BLOCKER, no tests run'}. `
    + `Exit code ${code}. (${((Date.now() - t0) / 1000).toFixed(1)} s)`)

  console.log('\n== Replay failures ==')
  if (!failures.length) console.log('  none: every migration loaded from scratch')
  console.log(`ROOT CAUSES (${roots.length})`)
  for (const f of roots) {
    console.log(`  ${f.file}${f.line ? ` line ${f.line}` : ''}  SQLSTATE ${f.sqlstate}: ${f.message}`)
    if (f.detail) console.log(`      detail: ${f.detail}`)
    if (f.where) console.log(`      where: ${f.where.split('\n').join(' / ')}`)
  }
  console.log(`KNOCK-ONS (${knocks.length})`)
  for (const root of roots) {
    const mine = knocks.filter(k => k.root === root)
    if (!mine.length) continue
    console.log(`  traced to ${root.file}:`)
    for (const k of mine) {
      console.log(`    ${k.file}${k.line ? ` line ${k.line}` : ''}  SQLSTATE ${k.sqlstate}: ${k.message}`
        + (k.via !== root ? `  (via ${k.via.file})` : ''))
    }
  }
  for (const w of WATCH) {
    const file = migrations.find(m => m.startsWith(w))
    const f = failures.find(x => x.file === file)
    if (!file) console.log(`  WATCH ${w}: no such migration file`)
    else if (!f) console.log(`  WATCH ${file}: applied cleanly in this replay`)
    else console.log(`  WATCH ${file}: ${f.root ? `KNOCK-ON of ${f.root.file}` : 'ROOT CAUSE'}, SQLSTATE ${f.sqlstate}: ${f.message}`)
  }
  await db.close()
  return code
}

let exitCode = 1
try {
  exitCode = await main()
} catch (e) {
  console.error(`CRASH: ${e.stack ?? e}`)
  exitCode = 1
}
process.exit(exitCode)
