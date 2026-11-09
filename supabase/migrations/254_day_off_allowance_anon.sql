-- P915 follow-up: day_off_allowance() is for signed-in VAs and admins only (the advisor flagged anon).
revoke execute on function public.day_off_allowance() from public, anon;
grant  execute on function public.day_off_allowance() to authenticated;
