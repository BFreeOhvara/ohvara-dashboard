-- Prompt 381: floating "Report a bug" button (Eterna-style), role-conditional
-- — submit form for agents, inbox for admins.

create type bug_report_status as enum ('new', 'resolved');

create table if not exists bug_reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references profiles(id) on delete cascade,
  description    text not null,
  screenshot_url text,
  page_url       text,
  status         bug_report_status not null default 'new',
  created_at     timestamptz not null default now()
);

create index if not exists bug_reports_status_idx on bug_reports (status, created_at desc);

alter table bug_reports enable row level security;

-- Reporters: insert + read their own reports (read isn't required by the v1
-- submit-and-forget flow, but harmless and matches the "reporters can SELECT
-- their own reports" ask).
create policy "Reporters insert own bug reports" on bug_reports for insert
  with check (reporter_id = auth.uid());

create policy "Reporters read own bug reports" on bug_reports for select
  using (reporter_id = auth.uid());

-- Admins: see and resolve every report. This table's admin SELECT-all is
-- intentional (Brayden needs the company-wide inbox) — unlike Prompt 379's
-- notifications bug, there's no "my own stuff" page here for it to leak
-- into, so it's kept as a plain broad policy rather than split like 087.
create policy "Admins read all bug reports" on bug_reports for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "Admins update bug reports" on bug_reports for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ── Storage: private bucket for optional screenshots ─────────────────────────
insert into storage.buckets (id, name, public)
values ('bug-screenshots', 'bug-screenshots', false)
on conflict (id) do nothing;

create policy "Reporters upload own bug screenshots" on storage.objects for insert
  with check (bucket_id = 'bug-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Reporters read own bug screenshots" on storage.objects for select
  using (bucket_id = 'bug-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Admins read all bug screenshots" on storage.objects for select
  using (
    bucket_id = 'bug-screenshots'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );
