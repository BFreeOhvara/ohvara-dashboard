---
date: 2026-10-28
tags: [ohvara, leads, decision]
goal: Policy Servicing Roadmap, Goal 1
---

# Lead Model Decision

Written by Finn, Oct 28, 2:00 PM, on branch `atlas/ce111367-keep-leads-lead-type-retire-mp-l`. Copy this file into the vault at `brain/ohvara/` (the vault is read-only from a robot worktree).

## Kept model

**One table: `public.leads`, with `lead_type` from migration 166.** Nothing is applied live; master still ends at 160.

- Meta mortgage-protection lead: `lead_type = 'mortgage_protection'`, `lead_source = 'meta'`.
- Google policy-help call: `lead_type = 'policy_help'`, `lead_source = 'google'`.
- 166's check, the line that allows both:
  `check (lead_type in ('cancellation', 'mortgage_protection', 'policy_help', 'policy_review'))`
- The agent on a lead is `leads.assigned_rep_id` (166, 168 and 171 all use it). The agent's own status is the new `leads.agent_status` (assigned / contacted / closed / bad). `leads.status` stays the cancellation pipeline enum, because changing it feeds the rep queues.
- /protect's consent record (time + wording version) and UTM tags go in `leads.qualifier_answers` (166), next to the qualifier answers. That is the same place lead-intake (8be0bfbd) put them.
- **The separate `mp_leads` table is retired.** No migration on this branch creates it, and nothing in `src` or `supabase/functions` reads it.

**Kept ledger: `agent_lead_ledger` (169), charged through `charge_lead` on `leads` (171).** Why: master's `PrepaidBalanceCard.jsx` already reads `agent_lead_ledger` / `agent_lead_balance`, and 171 already points that ledger at `leads`. The other ledger, `agent_balance_ledger` (162 and 163), points at `mp_leads` or has no charge path. This overrides the older Memories line "P11: 162 agent_balance_ledger kept".

Why not `mp_leads`: it only holds Meta leads. Google calls (170), texting (168) and the ledger move (171) were all built on `leads.lead_type`, so keeping `mp_leads` would mean reworking four branches instead of two.

## What changed on this branch

Brief: "build on `atlas/a653d312-settle-the-lead-branch-161-clash`". That branch has no commits of its own (its head, `cd3f032`, is already in master). The worktree guard blocks switching branches, so this work is committed on `atlas/ce111367-…`, which already contains all of a653d312.

- `supabase/migrations/161_agent_lead_settings.sql` **replaces** `161_mp_leads.sql` (3b0822cf). It keeps `agent_lead_settings` as it was, minus the unused delete policy and grant. It adds `leads.agent_status` and the repeat-phone index `leads (phone, created_at desc) where phone is not null`. It does not create `mp_leads` or `recovery_config.mp_lead_price_cents` (169's `price_per_lead_cents` map is the price).
- `supabase/migrations/162_assign_lead.sql` **replaces** `162_agent_balance_ledger.sql` (b2b96152). It keeps the old `assign_mp_lead` logic as `assign_lead(lead_id)` on `leads`, pointed at `agent_lead_ledger` + `charge_lead`. Other changes:
  - only active `role = 'agent'` profiles get leads;
  - if no price is set for the lead_type, the lead is not delivered.
  - It also adds the trigger `leads_typed_agents_only` (see risk 1).
  - **Apply order: 161 → 166 → 169 → 171 → 162.** A check at the top stops 162 if 166, 169 or 171 is missing.
- Both files reuse their own numbers (161, 162); no new number was taken. The runner reserved none for this task, so **no new migration file exists**. In both files, `grep -iE 'drop|truncate|delete'` finds only the foreign-key clause `on delete cascade` on `agent_lead_settings.agent_id` (161). It is needed so deleting an account still works. No DROP, TRUNCATE or DELETE statement.
- `submit-mp-lead` (core.ts, index.ts, core.test.ts):
  - inserts into `leads` with `lead_type 'mortgage_protection'`, `lead_source 'meta'`;
  - the 30-day check counts only `mortgage_protection` rows for that phone;
  - assignment calls `assign_lead`.
  - Unchanged: honeypot, per-IP 5/hour, per-phone 2/hour, consent version check and ok-only replies.
- `src/hooks/useMpLeads.js`:
  - reads `leads` where `lead_type = 'mortgage_protection'` and `assigned_rep_id = me` (RLS: `leads_rep_select` + 166's restrictive policy);
  - maps rows to the shape the page already uses;
  - changes `agent_status` only.
  - `Leads.jsx` and `App.jsx`: comments only.

## Every branch and migration, 161–172

| Migration | Branch | Verdict | Why / what to do |
|---|---|---|---|
| 161 `161_mp_leads.sql` | atlas/3b0822cf-migration-161-meta-lead-tables | **drop** (replaced) | Creates `mp_leads`. Its live parts are now `161_agent_lead_settings.sql` on this branch. Close the branch unmerged. |
| 162 `162_agent_balance_ledger.sql` | atlas/b2b96152-migration-162-prepaid-balance-le | **drop** (replaced). Its ledger is **dropped** | Second ledger (`agent_balance_ledger`, FK to `mp_leads`) + `assign_mp_lead` + `credit_topup`. Assign logic is now `162_assign_lead.sql` here. The one ledger is 169's. Close unmerged. |
| 163 `163_agent_balance_ledger.sql` | atlas/9f624389-stripe-prepaid-top-up-and-webhoo | **drop**. Its ledger is **dropped** | Third take on `agent_balance_ledger` (top-ups only) and a second top-up function (`create-balance-topup`). The kept top-up is `lead-balance-topup` on e1fb868b. Close unmerged. |
| 164 `164_public_form_attempts.sql` | atlas/088b3cc7-migration-161-hashed-ip-form-att | **drop** | Rival of 165 for the lasting per-IP limit. Not a lead or ledger table. |
| 165 `165_ip_limit_hits.sql` | atlas/790f1375-swap-the-public-form-s-in-memory | **keep** (rebase) | Lasting rate limit for submit-mp-lead. It edits `submit-mp-lead/core.ts`, so it must rebase onto this branch. |
| 166 `166_lead_types_delivery.sql` | atlas/36d240ca-migration-161-lead-types-qualifi | **keep** | The kept model. Header still says "161"; fix the comment when it merges. |
| 167 `167_mp_leads_type_delivered.sql` | atlas/7c283464-agent-portal-shows-delivered-mor | **drop** | Adds lead_type to `mp_leads`. 166 + this branch's hook do that job. Its Leads.jsx filter/badge work needs re-pointing to `useMpLeads` here if still wanted. |
| 168 `168_lead_followup_sms_log.sql` | atlas/ea81c4e0-instant-text-follow-up-gated-on- | **keep** — needs rebase onto 166 | Already reads `leads.lead_type = 'mortgage_protection'` and `assigned_rep_id`. Only has 168, not 166, in its history. `sms_live` stays off. |
| 169 `169_prepaid_lead_balance.sql` | atlas/7afb4166-migration-162-prepaid-lead-balan | **keep** (the one ledger) | `agent_lead_ledger` + `agent_lead_balance` + `charge_lead`. Its FK and `charge_lead` point at `mp_leads`; 171 moves both to `leads`, so 169 + 171 must land together. Cleaner rework: point 169 at `leads` directly. |
| 170 `170_va_desk.sql` | atlas/8aa97295-build-the-va-call-qualify-screen | **rework** — needs rebase onto 166 | Writes `lead_type 'policy_help'` into `leads`. **Bug:** `va_save_policy_help_lead` inserts 12 values into 11 columns (`p_agent` is listed twice), so the first save will fail. It also writes the agent to `transfer_agent_id`, not `assigned_rep_id`; decide which one counts as "this agent's lead". |
| 171 `171_charge_lead_on_leads.sql` | atlas/e1fb868b-stripe-top-up-and-webhook-credit | **keep** — needs rebase onto 166 and 169 | Moves the ledger to `leads`. Branch has neither 166 nor 169. Its `_shared/leadDelivery.ts` (assign → charge → unassign in TypeScript) overlaps `assign_lead` here, which charges in the same transaction: **rework**, so `deliver()` just calls `assign_lead`. |
| 172 `172_agent_duty.sql` | atlas/51e53ca5-migration-162-agent-duty-table-o | **keep** | Agent on-duty; not a lead or ledger table. |
| — (no migration) | atlas/8be0bfbd-public-lead-intake-function-for- | **drop** `lead-intake`. **Rework** its submit-mp-lead edits | `lead-intake` is a second public function for the same Meta form, writing `leads` with a different JSON shape (24h dedupe, `lead_id` in replies). /protect + `submit-mp-lead` is the one door now (ads point to /protect). Its submit-mp-lead edits still use `mp_leads` and return `lead_id`, which breaks the ok-only rule. Port only the loose-phone → E.164 helper onto this branch if wanted. Needs rebasing onto 166 / this branch either way. |
| — | atlas/a653d312-settle-the-lead-branch-161-clash | **superseded** by this branch | No commits of its own. |
| — | atlas/6ca1f056-rebuild-agent-leads-to-the-appro | **rebase** onto this branch | Appeared during this task (no commits yet). Any Leads page work must use the re-pointed `useMpLeads.js`. |
| — | atlas/5c97583e, 6e3096d9, e37fb897, ce523945, af603c2d, 3c76d818, 5555cb5e, 684c54c7 | **rebase or close** | They carry older copies of `useMpLeads.js` / `submit-mp-lead` on `mp_leads`. Any that merge must take this branch's versions. |

After this: one lead table (`leads`), one ledger (`agent_lead_ledger`), one top-up function (`lead-balance-topup`). No open branch that survives creates a second one. 3b0822cf, b2b96152, 9f624389 and 7c283464 should be closed unmerged.

### Need rebasing onto 166?

- **168 (ea81c4e0): yes.** Reads `leads.lead_type`; 166 is not in its history.
- **170 (8aa97295): yes**, plus the 12-values-for-11-columns fix.
- **atlas/8be0bfbd: yes** if anything from it is kept. Its `lead-intake` should be dropped (see table).
- **171 (e1fb868b): yes**, onto 166 **and** 169.

## `git branch -a` (Oct 28, 1:58 PM)

Re-pointed to the kept model: **`atlas/ce111367-keep-leads-lead-type-retire-mp-l`** (this branch: submit-mp-lead, useMpLeads, 161, 162). No other branch was changed: a robot can't commit to another branch's worktree. The rows above say what each one needs.

```
+ atlas/03ec7b56-migration-number-ledger-table-an
+ atlas/088b3cc7-migration-161-hashed-ip-form-att
+ atlas/36d240ca-migration-161-lead-types-qualifi
+ atlas/3b0822cf-migration-161-meta-lead-tables
  atlas/3c76d818-public-submit-mp-lead-edge-funct
  atlas/4aa41c9a-readme-ohvara-title-and-one-line
+ atlas/51e53ca5-migration-162-agent-duty-table-o
  atlas/5555cb5e-public-mortgage-protection-landi
  atlas/5c97583e-agent-leads-page-and-lead-settin
  atlas/684c54c7-build-public-mortgage-protection
+ atlas/6ca1f056-rebuild-agent-leads-to-the-appro
  atlas/6e3096d9-build-the-agent-leads-page-to-th
+ atlas/790f1375-swap-the-public-form-s-in-memory
+ atlas/7afb4166-migration-162-prepaid-lead-balan
+ atlas/7c283464-agent-portal-shows-delivered-mor
+ atlas/81750275-admin-on-duty-now-live-transfer-
  atlas/868dee54-shared-lasting-per-ip-limiter-re
+ atlas/8aa97295-build-the-va-call-qualify-screen
+ atlas/8be0bfbd-public-lead-intake-function-for-
+ atlas/9f624389-stripe-prepaid-top-up-and-webhoo
+ atlas/a41cebdc-rename-rudy-to-addie-in-repo-and
+ atlas/a653d312-settle-the-lead-branch-161-clash
+ atlas/af603c2d-on-duty-switch-card-on-agent-set
+ atlas/b2b96152-migration-162-prepaid-balance-le
* atlas/ce111367-keep-leads-lead-type-retire-mp-l
  atlas/ce523945-prepaid-balance-panel-on-billing
+ atlas/e1fb868b-stripe-top-up-and-webhook-credit
+ atlas/e37fb897-prepaid-balance-on-the-agent-bil
+ atlas/ea81c4e0-instant-text-follow-up-gated-on-
+ master
  remotes/origin/HEAD -> origin/master
  remotes/origin/atlas/088b3cc7-migration-161-hashed-ip-form-att
  remotes/origin/atlas/36d240ca-migration-161-lead-types-qualifi
  remotes/origin/atlas/3b0822cf-migration-161-meta-lead-tables
  remotes/origin/atlas/3c76d818-public-submit-mp-lead-edge-funct
  remotes/origin/atlas/4aa41c9a-readme-ohvara-title-and-one-line
  remotes/origin/atlas/51e53ca5-migration-162-agent-duty-table-o
  remotes/origin/atlas/5555cb5e-public-mortgage-protection-landi
  remotes/origin/atlas/5c97583e-agent-leads-page-and-lead-settin
  remotes/origin/atlas/684c54c7-build-public-mortgage-protection
  remotes/origin/atlas/6e3096d9-build-the-agent-leads-page-to-th
  remotes/origin/atlas/790f1375-swap-the-public-form-s-in-memory
  remotes/origin/atlas/7afb4166-migration-162-prepaid-lead-balan
  remotes/origin/atlas/7c283464-agent-portal-shows-delivered-mor
  remotes/origin/atlas/868dee54-shared-lasting-per-ip-limiter-re
  remotes/origin/atlas/8aa97295-build-the-va-call-qualify-screen
  remotes/origin/atlas/8be0bfbd-public-lead-intake-function-for-
  remotes/origin/atlas/9f624389-stripe-prepaid-top-up-and-webhoo
  remotes/origin/atlas/af603c2d-on-duty-switch-card-on-agent-set
  remotes/origin/atlas/b2b96152-migration-162-prepaid-balance-le
  remotes/origin/atlas/ce523945-prepaid-balance-panel-on-billing
  remotes/origin/atlas/e1fb868b-stripe-top-up-and-webhook-credit
  remotes/origin/atlas/e37fb897-prepaid-balance-on-the-agent-bil
  remotes/origin/atlas/ea81c4e0-instant-text-follow-up-gated-on-
  remotes/origin/client-role-fulfillment
  remotes/origin/master
  remotes/origin/parity/falcon-leads
  remotes/origin/remove-dead-indeed-scraper
```

## Flags

1. **Roadmap Goal 2's done-means must change.** It says a test submission "creates one `mp_leads` row assigned to an opted-in test agent". It must become: **"creates one `leads` row with `lead_type = 'mortgage_protection'` assigned to an opted-in test agent (`assigned_rep_id`, `delivered_at`, `agent_status = 'assigned'`)"**. "161 and 162 approved at the door" now means the replaced files on this branch, plus 166, 169 and 171.
2. **Risk 1, rep batch:** the cancellation rep batch (`assign_daily_batches`, 071, cron every 15 min) and `request_rep_leads` (147) take any `leads` row with `status = 'New'` and no `assigned_rep_id`. That includes an unassigned Meta or Google lead, which would hand a consumer's details to a cancellation rep. 162's trigger `leads_typed_agents_only` blocks that: a typed lead can only be assigned to an active agent. It needs 162 applied before any typed lead is written: 166 alone, or 170 / lead-intake, are not enough.
3. **Risk 2, agent writes:** on `mp_leads` an agent could change `status` only. On `leads`, the existing `leads_rep_update` policy (001) lets an agent update any column of a lead assigned to them, and lets any `closer` update any lead. Tightening that is RLS work for the door; not done here.
4. `leads.source` (the old scraper enum) defaults to `'google_maps'` on Meta rows; `lead_source = 'meta'` is the real source. Harmless, but reports should use `lead_source`.
5. **Master's head is `16862a2 TEMP unhide leads for preview`**, so `/agent/leads` is not hidden on master right now. This task makes no UI change; re-hiding is a separate call.
