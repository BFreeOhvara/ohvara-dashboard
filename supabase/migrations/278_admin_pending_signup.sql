-- P1017 — claiming an admin invite failed (claim-invite 500): pending_signups.role only allowed
-- agent | fulfillment, so the service role couldn't stage 'admin' (P1004 opened rep_invites and
-- handle_new_user to 'admin' but missed this table). Still only the service role writes this table,
-- and claim-invite only stages 'admin' from an owner's live admin invite.
alter table public.pending_signups drop constraint if exists pending_signups_role_check;
alter table public.pending_signups add constraint pending_signups_role_check
  check (role = any (array['agent'::text, 'fulfillment'::text, 'admin'::text]));
