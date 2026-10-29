# Agent Leads page screenshots (mocked)

Shows the real `/agent/leads` page (populated, empty with delivery on, empty with delivery off) without touching Ohvara's database. Every Supabase call is answered by Playwright against a fake host. Nothing is stored or sent.

## How to run

```
npm run shots:leads            # writes to qa/agent-leads
node scripts/leads-shots.mjs some/other/dir
```

Writes 12 PNGs (`leads-<scenario>-<width>-<theme>.png`; 3 scenarios x 1440 and 390 x light and dark) and `measurements.json`. The PNGs are git-ignored (`qa/agent-leads/.gitignore`); only this report and `measurements.json` are committed. Exits 1 on any error card, page error, query mismatch, unexpected request, missing settings card, wrong card count, missing empty heading or (at 390) sideways scroll.

## What is mocked

- The script sets `VITE_SUPABASE_URL=https://mock.supabase.co`, a fake anon key and `VITE_LEADS_PAGE=1` inside its own process, then starts Vite. No `.env` file, Vercel setting or real key is involved.
- `LEADS_PAGE` is `import.meta.env.DEV && VITE_LEADS_PAGE === '1'`, and `App.jsx` also guards the `import()` with `import.meta.env.DEV`. A production build never mounts the route or ships the page, even if the variable leaks into Vercel (checked: with the flag on and off, `dist/assets` has no Leads chunk and no "Delivered leads").
- A test agent profile (role `agent`, time zone America/Chicago) and a session in localStorage `sb-mock-auth-token`.
- `GET /rest/v1/leads` must carry `select=id,created_at,contact_name,phone,state,qualifier_answers,agent_status,delivered_at`, `lead_type=eq.mortgage_protection`, `assigned_rep_id=eq.<test agent id>`, `order=delivered_at.desc.nullslast` and `limit=200`. Anything else is recorded in `mismatches` and answered 400.
- `GET /rest/v1/agent_lead_settings` must carry `select=active,states,daily_cap` and `agent_id=eq.<test agent id>` (same rule). Answers with the row, or no row (`[]`; the single-object form gets `null`).
- Any PATCH/POST/PUT/DELETE to `leads` or `agent_lead_settings` is answered 200 with `[]` and recorded as `METHOD table`. Nothing is stored.
- Scenarios: `populated` = 5 made-up leads (555 numbers; statuses new, contacted, closed, bad, new; one very long name; one with no phone; one with partial answers; delivered today, yesterday and 3 to 8 days ago) and settings `{active: true, states: [FL, OH, TX], daily_cap: 5}`. `empty-on` = no leads, same settings ("No leads yet"). `empty-off` = no leads, no settings row ("Delivery is off").

## Allowed requests (everything else fails the run)

Found by running once with the list empty and reading `unexpected`. Each is answered with an empty body.

| Request | Why the app chrome makes it |
|---|---|
| `GET carriers` | the app shell reads the carrier list |
| `GET policies` | app chrome reads the agent's policies |
| `GET notifications` | bell in the header |
| `GET app_settings` | app-wide switches (empty = defaults) |
| `GET agent_billing_tiers` | billing gate reads the tier list |
| `rpc my_standing_threads` | Messages badge in the nav |
| `rpc agent_weekly_usage` | billing usage for the gate |
| `rpc my_money_banner` (null) | red money banner (none) |
| `rpc my_push_settings` (`{push_on:false}`) | push switch state |
| `GET /functions/v1/fetch-secrets` | SecretsContext (empty = env defaults) |
| `rpc get_my_profile` | the test agent profile |

Any other table, rpc, function, auth call, any write to one of these, and any host other than localhost and `mock.supabase.co` (no font or asset host is needed today) is recorded in `unexpected` and fails the run.

## Click check

In the populated 1440 light run only, after the screenshot: click Contacted on the first lead card and Save settings once. Recorded and answered 200 by the mock: `PATCH leads`, `PATCH agent_lead_settings` (the settings row exists, so the page updates rather than inserts). No other writes in any run. No shots are taken after the clicks.

## Measurements (from measurements.json)

All 12 rows: errorCards 0 (selector `section.ov-card[role="alert"]`), pageErrors [], mismatches [], unexpected [], settings card present. Each row also records `leadsQueriesChecked` and `settingsQueriesChecked` (at least 1, i.e. a request with the exact query was seen). Empty-on rows show "No leads yet", empty-off rows show "Delivery is off".

| shot | lead cards | settings card | error cards | scrollWidth/clientWidth | maxRight | requests |
|---|---|---|---|---|---|---|
| leads-populated-1440-light | 5 | yes | 0 | 1425/1440 | 1425 | GET leads, GET agent_lead_settings, PATCH leads, PATCH agent_lead_settings |
| leads-populated-1440-dark | 5 | yes | 0 | 1425/1440 | 1425 | GET leads, GET agent_lead_settings |
| leads-populated-390-light | 5 | yes | 0 | 390/390 | 390 | GET leads, GET agent_lead_settings |
| leads-populated-390-dark | 5 | yes | 0 | 390/390 | 390 | GET leads, GET agent_lead_settings |
| leads-empty-on-1440-light | 0 | yes | 0 | 1425/1440 | 1425 | GET leads, GET agent_lead_settings |
| leads-empty-on-1440-dark | 0 | yes | 0 | 1425/1440 | 1425 | GET leads, GET agent_lead_settings |
| leads-empty-on-390-light | 0 | yes | 0 | 390/390 | 390 | GET leads, GET agent_lead_settings |
| leads-empty-on-390-dark | 0 | yes | 0 | 390/390 | 390 | GET leads, GET agent_lead_settings |
| leads-empty-off-1440-light | 0 | yes | 0 | 1425/1440 | 1425 | GET leads, GET agent_lead_settings |
| leads-empty-off-1440-dark | 0 | yes | 0 | 1425/1440 | 1425 | GET leads, GET agent_lead_settings |
| leads-empty-off-390-light | 0 | yes | 0 | 390/390 | 390 | GET leads, GET agent_lead_settings |
| leads-empty-off-390-dark | 0 | yes | 0 | 390/390 | 390 | GET leads, GET agent_lead_settings |

## What I noticed (described, not fixed)

- At 1440 the page content and backdrop stop at 1425px: `scrollWidth` is 1425 against a `clientWidth` of 1440, so a 15px strip on the right is not covered (visible as a plain edge in the dark shots). Nothing scrolls sideways. The 390 shots are exact.
- Full-page shots of fixed elements are artifacts, not bugs: at 1440 the navy/teal sidebar ends at the 900px viewport height, and at 390 the bottom tab bar floats in the middle of the page.
- At 390 the settings card sits below the whole lead list, so with five leads "Save settings" is about four screens down. The hero's "Lead settings" button scrolls to it.
- Empty-off at 390 says "Turn it on and pick your states to start getting leads" twice in a row (the Delivery is off card, then the box inside the settings card).
- The very long name wraps to three lines at 390 and to one line at 1440 without pushing the status pill off the card.
- "Contacted" uses the blue booked tone and "Closed" green; the New pill is grey. No amber on the page.
- Weekly count depends on the day the script runs (the fixture is relative to now): on a Monday only today's lead counts toward "this week".
