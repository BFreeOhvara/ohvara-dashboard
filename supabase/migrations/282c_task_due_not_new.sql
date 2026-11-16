-- P1023 follow-up: "Task due soon" skips a task made in the last 2 hours (its Client request / New client notice
-- already said when it's due). 282 in this repo already carries this line; this matches the live history.
do $$
begin
  execute replace(pg_get_functiondef('public.notify_call_times(timestamptz)'::regprocedure),
    E'and s.due_at > p_now and s.due_at <= p_now + interval ''2 hours''\n',
    E'and s.due_at > p_now and s.due_at <= p_now + interval ''2 hours''\n       and s.created_at < p_now - interval ''2 hours''\n');
end $$;
revoke execute on function public.notify_call_times(timestamptz) from public, anon, authenticated;
