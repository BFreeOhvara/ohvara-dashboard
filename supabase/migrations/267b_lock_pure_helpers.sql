-- P954: three pure text helpers were left runnable by signed-out users (anon), which
-- the p922 tripwire (supabase/tests/p922_locked_doors.sql) catches. Each is only used
-- inside SECURITY DEFINER functions (playbook_save, servicing_path, servicing_task_path,
-- launch_checks_sweep), which run as the owner, and the app never calls them directly,
-- so nobody but the server needs to run them.
-- Named 267b so it sorts after 267 without taking a new number (P955 may take 268).
revoke execute on function public.playbook_norm(text)      from public, anon, authenticated;
revoke execute on function public.playbook_action(text)    from public, anon, authenticated;
revoke execute on function public.launch_check_words(text) from public, anon, authenticated;
grant  execute on function public.playbook_norm(text)      to service_role;
grant  execute on function public.playbook_action(text)    to service_role;
grant  execute on function public.launch_check_words(text) to service_role;
