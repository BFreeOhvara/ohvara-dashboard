-- Migration 272: where each VA is in each training video (Prompt 985)
--
-- One row per person, per lesson, per version (desktop / phone). It holds their
-- spot (pos), the furthest point they have really played to (furthest), which
-- 2-second parts they have seen (seen), and whether they have played it to the
-- end (watched). The portal blocks skipping past `furthest` until `watched`.
-- Saved here so closing the app, signing out, or moving from desk to phone
-- picks up in the same place.
--
-- Writes go through save_training_video(), which only ever moves forward:
-- furthest never goes down, watched never goes back to false, seen only grows.
-- pos is always the newest spot. Each person reads and writes only their own
-- rows; admins can read everyone's. Rows go when the account is deleted.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.va_training_video (
  user_id    uuid not null references auth.users(id) on delete cascade,
  lesson_id  text not null check (char_length(lesson_id) between 1 and 40),
  variant    text not null default 'desktop' check (variant in ('desktop', 'phone')),
  pos        real not null default 0 check (pos >= 0),
  furthest   real not null default 0 check (furthest >= 0),
  seen       smallint[] not null default '{}',
  watched    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id, variant)
);

alter table public.va_training_video enable row level security;

drop policy if exists va_training_video_read on public.va_training_video;
create policy va_training_video_read on public.va_training_video
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No insert/update/delete policies: writes only through the function below.
revoke all on public.va_training_video from anon;
grant select on public.va_training_video to authenticated;

create or replace function public.save_training_video(
  p_lesson text, p_variant text, p_pos real, p_furthest real, p_seen smallint[], p_watched boolean
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  v text := case when p_variant = 'phone' then 'phone' else 'desktop' end;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_lesson is null or char_length(p_lesson) not between 1 and 40 then raise exception 'bad lesson'; end if;
  insert into public.va_training_video as t (user_id, lesson_id, variant, pos, furthest, seen, watched, updated_at)
  values (me, p_lesson, v, greatest(coalesce(p_pos, 0), 0), greatest(coalesce(p_furthest, 0), 0),
          coalesce((select array_agg(distinct b order by b) from unnest(coalesce(p_seen, '{}')) b where b between 0 and 5000), '{}'),
          coalesce(p_watched, false), now())
  on conflict (user_id, lesson_id, variant) do update set
    pos        = excluded.pos,
    furthest   = greatest(t.furthest, excluded.furthest),
    seen       = (select coalesce(array_agg(distinct b order by b), '{}') from unnest(t.seen || excluded.seen) b),
    watched    = t.watched or excluded.watched,
    updated_at = now();
end;
$function$;

revoke all on function public.save_training_video(text, text, real, real, smallint[], boolean) from public, anon;
grant execute on function public.save_training_video(text, text, real, real, smallint[], boolean) to authenticated;
