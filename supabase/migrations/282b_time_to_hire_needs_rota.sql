-- P1023 follow-up: no time-to-hire notice while no shifts are on next week's rota (nothing to compare against).
-- 282 in this repo already carries the same body; this file matches the live migration history.
create or replace function public.notify_time_to_hire(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  f jsonb := public.va_capacity_forecast(p_now);
  k int := (f ->> 'short_vas')::int;
  a uuid;
  n int := 0;
begin
  if k < 1 or coalesce((f ->> 'vas')::int, 0) = 0 then return 0; end if;
  for a in select * from public.notify_admins() loop
    if public.notify(a, 'time_to_hire',
         'Next week needs about ' || case k when 1 then 'one more VA' when 2 then 'two more VAs' when 3 then 'three more VAs' else k || ' more VAs' end,
         (f ->> 'need_hours') || ' hours of booked work, ' || (f ->> 'have_hours') || ' hours on the rota.',
         '/admin/fulfillment', false, 'hire:' || to_char(p_now at time zone 'America/Chicago', 'IYYY-IW'), f) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$fn$;
revoke execute on function public.notify_time_to_hire(timestamptz) from public, anon, authenticated;
