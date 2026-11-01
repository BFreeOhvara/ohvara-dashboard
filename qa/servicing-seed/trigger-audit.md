# Sample seed: trigger and cron audit

One row for each trigger on each seeded table and each cron job, from `pg_trigger` and `cron.job` in the migration replay (182 files, master at migration 193). `npm run test:seed` fails if a trigger or cron job in the replay is missing here, if a row here is not in the replay, or if a row cites an assertion that did not run.

**What this does not prove:** PGlite replays migration files only. A trigger or cron job added directly on live shows up in section 2 of `door-dry-run.sql` as `NOT IN THE AUDIT`, and whoever runs the file stops there.

The seed runs with no `auth.uid()` (SQL editor, service role), inserts only, and changes no row it did not insert. The wipe only deletes. So anything that fires on UPDATE of a seeded row can only come from `policies_compute_estimated_commission`, which updates `estimated_commission` on each new policy and nothing else.

**Disabled inside the seed's transaction, re-enabled before commit:** `policies_recompute_leaderboard`, `policies_check_goal_milestones`, `policy_messages_notify_trigger`.

**Not a send, but a person could see it:**

- Row security lets any rep read every `fulfillment_assigned` policy and its thread, sample rows included. No page shows them: Fulfillment screens keep only `replaced_old_policy` not false and the rep's own rows (`useFulfillmentQueue`, `MyCalls`, `Pipeline`), and per-client threads left the UI in P721. `my_message_threads` would count a sample message on a row with no rep as unread, but the sidebar badge counts standing threads only.
- `policy_messages` is in the `supabase_realtime` publication, so a page open at that moment can refresh. Nothing is sent.
- The saved client reads needs attention for 14 days from its saved date, then protected. The seed dates it 3 days back, so the post-seed check reads 2/7/2/1/1 on the day it runs, and the counts drift to 2/8/1/1/1 after 11 days. Running the file again resets it.

## Triggers

| On | Name | What it can send | Why it cannot fire for samples | Proved by |
|----|------|------------------|--------------------------------|-----------|
| `policies` | `a0_block_inactive_writer` | Nothing. Refuses a write from an inactive signed-in user. | Returns at once with no `auth.uid()`. | [c8] the seed and wipe ran |
| `policies` | `a0_block_locked_self_signup` | Nothing. Refuses a write from a locked signup. | Returns at once with no `auth.uid()`. | [c8] the seed and wipe ran |
| `policies` | `a0_block_self_signup_no_servicing` | Nothing. Refuses a deal without a plan. | Returns at once with no `auth.uid()`. | [c8] the seed and wipe ran |
| `policies` | `a1_policies_demo` | Nothing. Stamps `is_demo` from the agent. | Writes only the row being inserted. | [c8] O's rows and the rest unchanged |
| `policies` | `a2_policies_servicing_guard` | Nothing. Refuses a rep, call or `carrier_name` on a row with no old policy. | Those rows hold none of them, so it never raises. | [r7] |
| `policies` | `audit_policies_delete` | One permanent `admin_audit_log` row per deleted policy. No person is told. | It does fire on the wipe, by design (153). Nothing reads it to send anything. | [c6] |
| `policies` | `policies_booking_rules` | Nothing. Refuses a bad booking time. | Returns at once with no `auth.uid()`. | [c8] the seed and wipe ran |
| `policies` | `policies_check_goal_milestones` | Bell to the policy's agent at 50% and 100% of their goal, and stamps their profile. | **Disabled in the seed's transaction.** No skip setting. Would only reach the test agent, but it writes `profiles`. | [d5] [e-enabled] [k1] |
| `policies` | `policies_compute_estimated_commission` | Nothing. Updates `estimated_commission` on the new row. | Runs as written. Its update touches only that column; a sample carrier and product have no rate, so it writes null. | [c5] [d3] |
| `policies` | `policies_enforce_weekly_cap` | Nothing. Its body has been a no-op since 188. | Returns at once. | [f1] |
| `policies` | `policies_events_log` | No message. Writes a `booked` policy_events row. | Runs as written. The seed backdates that row and flags it in the same transaction. | [b-policy_events] |
| `policies` | `policies_fulfillment_autoassign` | Gives a row to a real rep, who would then be notified. | Rows with an old policy hold the explicit `--fulfillment-id`. Rows with no old policy return early. | [r6] [r7] [r8] |
| `policies` | `policies_fulfillment_cancel` | A `fulfillment_cancels` row, which is pay for a rep, and a needs-listen alert to admins. | Fires on UPDATE of `fulfillment_stage`. The cancelled rows are inserted as Complete, and nothing updates that column. | [d3] [e3] |
| `policies` | `policies_missed_clear` | Nothing. Clears `missed_*` on insert. | Writes only the row being inserted. | [r4] |
| `policies` | `policies_notify` | `call_booked` to the rep; `weekly_limit` to the agent; on update, cancelled and no-answer alerts to the agent. | `skip_assign_notify` is on and no row has `scheduled_call_at`. `weekly_limit` counts this week's rows and samples have none, and it could only reach the test agent. The update branches need a changed stage or a no-answer, and neither happens. | [d1] [d8] |
| `policies` | `policies_recompute_leaderboard` | Bell to whoever leads the month, and stamps their profile. That is a real agent: the test agent is excluded from the ranking. | **Disabled in the seed's transaction.** No skip setting. | [d5] [e5] [e-enabled] [k1] |
| `policies` | `policies_recovery_clear` | Nothing. Clears `recovery_*` on a Complete row. | Fires on update only, and those fields are already null. | [r4] |
| `policies` | `policies_reset_lapse_notified` | Nothing. Clears `lapse_check_notified_at`. | Fires on update only, and `next_lapse_check_at` stays null. | [r5] |
| `policies` | `policies_sms_consent` | Nothing. Stamps consent. | `sms_consent` is false, so it clears the stamp fields. | [b-consent] |
| `policies` | `policies_stamp_cancellation_times` | Nothing. Stamps times on an update. | Fires on update only, and the stage does not change. | [a8] |
| `policies` | `policies_updated_at` | Nothing. | Touches only the row. | [c8] O's rows and the rest unchanged |
| `policies` | `policies_zz_demo_guard` | Nothing. Drops a rep on the other demo side. | The seed stops first if the fulfillment account is on the other side, and stops again if a row lost its rep. | [r6] |
| `policy_fulfillment_details` | `a0_block_inactive_writer` | Nothing. | Returns at once with no `auth.uid()`. | [b-details] |
| `policy_fulfillment_details` | `a0_block_locked_self_signup` | Nothing. | Returns at once with no `auth.uid()`. | [b-details] |
| `policy_fulfillment_details` | `fulfillment_details_updated_at` | Nothing. | Fires on update only, and nothing updates these rows. | [b-details] |
| `policy_events` | `policy_events_append_only` | Nothing. Refuses a change to the permanent record. | The seed's only update has `at = now()`, which it allows. The wipe goes by cascade, which it allows. | [c4] [c7] |
| `policy_events` | `policy_events_no_truncate` | Nothing. Refuses truncate. | Nothing truncates. | [c4] the wipe ran with no truncate |
| `policy_messages` | `a0_block_inactive_writer` | Nothing. | Returns at once with no `auth.uid()`. | [a10] |
| `policy_messages` | `a0_block_locked_self_signup` | Nothing. | Returns at once with no `auth.uid()`. | [a10] |
| `policy_messages` | `policy_messages_notify_trigger` | Bell, email and push to the other side of the thread. | **Disabled in the seed's transaction.** No skip setting. It would reach the test accounts only, but that is a bell and an email for every sample message. | [d8] [e-enabled] [k2] |
| `policy_messages` | `policy_messages_stamp_trigger` | Nothing. Stamps the sender's name and role. | Writes only the row being inserted. | [a10] |
| `leads` | `a0_block_locked_self_signup` | Nothing. | Returns at once with no `auth.uid()`. | [b-leads] |
| `leads` | `lead_booked_assign_closer` | A POST to `assign-closer` through `net`. | Fires on update only, and sample leads are inserted whole. | [d2] [e2] |
| `leads` | `leads_agent_status_only` | Nothing. Limits what an agent may change. | Fires on update only. | [b-leads] |
| `leads` | `leads_rep_outcome` | Nothing that reaches a person from here. Moves queue rows. | Fires on update only. | [c5] |
| `leads` | `leads_typed_agents_only` | Nothing. Refuses handing a lead to the wrong person. | Fires on update of `assigned_rep_id` only. | [b-leads] |
| `leads` | `leads_typed_inbound_sync` | Nothing. Keeps `agent_status` in step with `inbound_stage`. | The seed sets both to agree, so it does not raise. | [b-leads] |
| `leads` | `leads_updated_at` | Nothing. | Fires on update only. | [b-leads] |
| `lead_sms_replies` | `lead_sms_replies_e164` | Nothing. Normalizes the phone. | The seed's phones are already in that form. | [b-lead_sms_replies] |
| `inbound_events` | `a0_block_inactive_writer` | Nothing. | Returns at once with no `auth.uid()`. | [b-inbound_events] |
| `inbound_events` | `a0_block_locked_self_signup` | Nothing. | Returns at once with no `auth.uid()`. | [b-inbound_events] |
| `servicing_tasks` | `a0_block_inactive_writer` | Nothing. | Returns at once with no `auth.uid()`. | [b-servicing_tasks] |
| `servicing_tasks` | `a0_block_locked_self_signup` | Nothing. | Returns at once with no `auth.uid()`. | [b-servicing_tasks] |
| `servicing_tasks` | `servicing_tasks_touch` | Nothing. Stamps `updated_at` and `done_at`. | Fires on update only. The seed writes `done_at` itself. | [a9] |
| `help_calls` | `help_calls_touch_updated_at` | Nothing. | Fires on update only. | [b-help_calls] |

## Cron jobs

Plain-SQL jobs were run as written in the test, after the seed. Jobs that post to an edge function were not: the function can't run in PGlite, so the row gives the reason from its query, and `[e2]` shows the queue did not move.

| On | Name | What it can send | Why it cannot fire for samples | Proved by |
|----|------|------------------|--------------------------------|-----------|
| `cron` | `daily-batch-assign` | Moves cancellation leads to reps with role `rep`. | Only reads `lead_type = 'cancellation'`. Sample leads have other types. | [e1] ran as written |
| `cron` | `eod-pipeline-sweep` | Queues leads for reps. | Needs `batch_date` today or a status of No Answer or Follow-Up. Samples have neither. | [e1] ran as written |
| `cron` | `fulfillment-cancel-check` | Posts to check a cancel for pay. | Gated on a `fulfillment_cancels` row with status checking. The seed adds none. | [e3] |
| `cron` | `fulfillment-pay-run` | Pays reps. | Pays from `fulfillment_cancels`. The seed adds none. `payouts_live` stays off. | [e3] |
| `cron` | `missed-sweep` | Strike on the rep, bells to admins and the agent, moves the call, apology texts. | Needs `scheduled_call_at`. No sample row has one. | [e1] [d6] [d7] |
| `cron` | `notify-call-times` | Bell to the rep before a call and when it is late. | Needs `scheduled_call_at`. No sample row has one. | [e1] [d8] |
| `cron` | `notify-email` | Sends queued emails. | Gated on queued rows in `notification_emails`. The seed queues none. | [e1] [e2] |
| `cron` | `notify-hourly` | 8 AM needs-attention bell to the agent; Monday summary to agents and admins. | Needs `recovery_step` and no-answer for the bell. The summary counts last Monday on, and sample rows are older than that. | [e1] [r3] [d10] [k7] |
| `cron` | `notify-job-failures` | Bell to admins when a job fails. | Reads cron run history, not seeded rows. | [e1] ran as written |
| `cron` | `notify-lapse-checkins` | Bell to the agent. | Needs `next_lapse_check_at`. It is null on every sample row. | [r5] [e1] |
| `cron` | `notify-push` | Sends queued pushes. | Gated on queued rows in `notification_pushes`. The seed queues none. | [e1] [e2] |
| `cron` | `process-lead-queues` | Returns follow-ups to reps. | Reads `follow_up_queue`. The seed adds none. | [e1] ran as written |
| `cron` | `process-reminders` | Sends due reminders. | Reads `reminder_log`. The seed adds none. | [c5] |
| `cron` | `recovery-sms` | Texts clients. | `sms_live` is off, and even with it on the claim needs `recovery_next_kind` or `missed_next_kind`, which are null. | [d9] [r4] |
| `cron` | `recovery-sweep` | Bell to the agent at the end of the no-answer flow. | Needs `recovery_next_kind = 'handoff'`. It is null. | [e1] [r4] |
| `cron` | `redistribute-no-answers` | Moves leads between reps. | Reads leads with status No Answer and `no_answer_at`. Samples have neither. | [e1] [b-leads] |
| `cron` | `trigger-re-engagement` | Texts cancellation leads. | Reads leads with status Voicemail or No Answer and yesterday's `batch_date`. Samples have neither. | [e1] [b-leads] |
