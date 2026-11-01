# Wording sweep: agents see "lead" and "leads", never "inbound"

Built on origin/master 906b30a. Code names, routes (`/agent/inbounds/...`), DB columns, query keys, the kind `'inbound'` and `source: 'inbound'` are unchanged. No migrations, nothing under supabase/, no billing or webhook code.

## Changed strings (file:line in the new tree)

| File:line | Old | New |
|---|---|---|
| src/components/agent/ClientsV2Parts.jsx:28 | From inbounds | From leads |
| src/components/agent/ClientsV2Parts.jsx:115 | From an inbound | From a lead |
| src/components/agent/ClientsV2Parts.jsx:147 | When you mark an inbound Sold | When you mark a lead Sold |
| src/components/agent/ClientsV2Parts.jsx:336 | Sold from an inbound (and "Sold <date> from an inbound") | Sold from a lead (and "Sold <date> from a lead") |
| src/components/agent/PlanV2Parts.jsx:146 | What we do with every inbound | What we do with every lead |
| src/components/agent/PortalV2Nav.jsx:28, 53 | Inbounds (nav label) | Leads |
| src/components/agent/PrepaidBalanceCard.jsx:25 | Inbound form / Inbound call | Lead form / Lead call (the a/an is computed, so "not a Lead call") |
| src/lib/activityKinds.js:61 | row label Inbounds, pill Inbound | Leads, Lead |
| src/components/agent/TodayCards.jsx:131, 237 | fallback Inbound | Lead |
| src/components/agent/TodayCards.jsx:137 | Open inbound | Open lead |
| src/components/agent/TodayCards.jsx:261 | Replies from your inbounds | Replies from your leads |
| src/components/agent/TodayCards.jsx:333, 366, 367 | New inbounds (link, aria-label, title) | New leads |
| src/components/agent/TodayCards.jsx:350 | aria-label Your inbounds today | Your leads today |
| src/components/agent/TodayCards.jsx:369 | your inbounds (load error) | your leads |
| src/components/agent/TodayCards.jsx:386 | No new inbounds yet | No new leads yet |
| src/components/layout/GlobalSearch.jsx:186 | placeholder Search clients, inbounds, pages… (agent only) | Search clients, leads, pages… |
| src/components/layout/GlobalSearch.jsx:187 | aria-label Search clients, inbounds and pages | Search clients, leads and pages |
| src/components/layout/GlobalSearch.jsx:213 | result group Inbounds | Leads |
| src/components/layout/GlobalSearch.jsx:246 | No clients, inbounds or pages match | No clients, leads or pages match |
| src/components/layout/GlobalSearch.jsx:249 | Enter to open the inbound | Enter to open the lead |
| src/pages/agent/v2/Calendar.jsx:33 | Inbound / Inbound appointment / Open inbound | Lead / Lead appointment / Open lead |
| src/pages/agent/v2/Calendar.jsx:191 | legend Inbound | Lead |
| src/pages/agent/v2/Calendar.jsx:421 | mark the outcome on the inbound | mark the outcome on the lead |
| src/pages/agent/v2/Calendar.jsx:443 | explainer Inbounds | Leads |
| src/pages/agent/v2/Calendar.jsx:522, 631, 640, 651 | Booked calls and inbounds that book | Booked calls and leads that book |
| src/pages/agent/v2/InboundDetail.jsx:181 | fallback title Inbound | Lead (title and crumb read "Leads / <name>") |
| src/pages/agent/v2/InboundDetail.jsx:191 | We couldn't load this inbound | We couldn't load this lead |
| src/pages/agent/v2/InboundDetail.jsx:196 | This inbound isn't here | This lead isn't here |
| src/pages/agent/v2/InboundDetail.jsx:214, 216 | aria-label Inbound, chip fallback Inbound | Lead |
| src/pages/agent/v2/Inbounds.jsx:272 | You're not getting inbounds yet | You're not getting leads yet |
| src/pages/agent/v2/Inbounds.jsx:338 | aria-label Inbound type | Lead type |
| src/pages/agent/v2/Inbounds.jsx:360 | We couldn't load your inbounds | We couldn't load your leads |
| src/lib/inbounds.test.js:68-70, 100 | asserted Inbounds / not getting inbounds yet | asserts Leads / not getting leads yet |
| scripts/calendar-shots.mjs, overview-today-shots.mjs, portal-v2-more-shots.mjs, sample-views-check.mjs | asserted the old wording | assert the new wording |

Already lead-worded on master and left alone: Activity filter chips and event kind ("Lead came in", "New lead"), the Leads page header and crumb, the More row, the Overview "See all leads" link, the Leads sidebar row. There is no "Get leads" panel text in src yet (GetInboundsSlot renders nothing) and no notification text with the word; the guard found none. The sample fixtures (inboundsSample.js, calendarSample.js) hold only code names and comments.

## Guard

`scripts/check-wording.mjs` (`npm run check:wording`) parses every src .js/.jsx with espree (ships with eslint), skips tests, comments and imports, and flags JSX text, capitalized Inbound, "inbound" next to other words, and any label/title/placeholder/aria-label/text/sub/what prop containing it. `npm test` runs it first (scripts/run-tests.mjs). It is not in prebuild, so Vercel builds are unaffected.
- Pre-change source: it fails and lists every string above.
- This branch: "Wording check passed (222 files)".
- A throwaway `const x = 'New inbound'` in a src file made `npm test` exit non-zero; it was removed.

## Rendered check (scripts/wording-shots.mjs, Supabase mocked, light theme, fixed clock Fri Oct 30, 12:10 PM)

Visible text (body innerText) and every aria-label / title / placeholder / alt / aria-description are searched for /inbound/i. "leads-empty" is the extra "You're not getting leads yet" banner; "search" is the header search typed with "Nadia" (group heading reads Leads). Sideways scroll is scrollWidth minus viewport width (none = 0 or less).

### After (this branch): all pass

| Page | Width | /inbound/ hits | Sideways scroll |
|---|---|---|---|
| overview | 1440 | 0 | none |
| search (typed "Nadia") | 1440 | 0 | none |
| leads | 1440 | 0 | none |
| lead | 1440 | 0 | none |
| calendar | 1440 | 0 | none |
| clients | 1440 | 0 | none |
| activity | 1440 | 0 | none |
| more | 1440 | 0 | none |
| billing | 1440 | 0 | none |
| settings | 1440 | 0 | none |
| leads-empty | 1440 | 0 | none |
| overview | 390 | 0 | none |
| leads | 390 | 0 | none |
| lead | 390 | 0 | none |
| calendar | 390 | 0 | none |
| clients | 390 | 0 | none |
| activity | 390 | 0 | none |
| more | 390 | 0 | none |
| billing | 390 | 0 | none |
| settings | 390 | 0 | none |
| leads-empty | 390 | 0 | none |

### Before (pre-change src, same script)

| Page | Width | /inbound/ hits | Sideways scroll |
|---|---|---|---|
| overview | 1440 | 3 | none |
| search (typed "Nadia") | 1440 | 5 | none |
| leads | 1440 | 3 | none |
| lead | 1440 | 3 | none |
| calendar | 1440 | 5 | none |
| clients | 1440 | 6 | none |
| activity | 1440 | 2 | none |
| more | 1440 | 3 | none |
| billing | 1440 | 8 | none |
| settings | 1440 | 2 | none |
| leads-empty | 1440 | 4 | none |
| overview | 390 | 4 | none |
| leads | 390 | 1 | none |
| lead | 390 | 1 | none |
| calendar | 390 | 5 | none |
| clients | 390 | 4 | none |
| activity | 390 | 0 | none |
| more | 390 | 0 | none |
| billing | 390 | 6 | none |
| settings | 390 | 0 | none |
| leads-empty | 390 | 2 | none |

Hit details: checks-before.json and checks-after.json. Shots: <page>-<before|after>-<1440|390>-light.png for overview, leads, lead, calendar, clients, activity, more, billing, settings, leads-empty, plus search-<before|after>-1440-light.png. The clients shot opens `/agent/clients?stage=cancelled` so the "Your clients" box (From a lead chips) is on screen.
