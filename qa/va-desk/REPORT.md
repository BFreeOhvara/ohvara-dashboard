# VA desk (/fulfillment/leads): six-size check

Source: the real VA desk code (branch atlas/eac4b2e0) with every Supabase call answered by
Playwright routes in `shots.mjs` (mocked network, mocked "Test Fulfill" fulfillment login).
This is not the local Supabase stack, and nothing touches Ohvara's live project.
Rerun: `node qa/va-desk/shots.mjs` from the repo root (needs the VA desk sources on the branch).

Kept in `out/`: queue and claimed view at 1920 / 1440 / 390, light and dark (12 images), four
state shots (Book, 3 of 4 locked, hold ended at 1440 light and 390 dark), the approved mockup
frames at 1440, and `results.json` (all 33 runs with their measurements). The script writes
the other state shots too.

| Check | Result (from results.json) |
| --- | --- |
| Sideways scroll | none in any run: scrollWidth 1905/1920, 1425/1440, 390/390 |
| Price, premium, quote, cost or benefit text on the page | none; "coverage" appears only in the mockup's logistics line and the "Coverage question" label |
| Page errors | none (realtime-socket noise from the mock host is filtered) |
| Checklist lock | 3 of 4: all three outcome buttons disabled; 4 of 4: all enabled |
| Book | agent, day, time, "Book Thu 29, 8:00 AM"; insert, then va_set_lead_outcome outcome=booked with the booking id |
| Transfer | body carries the lead, agent and checklist only |
| Claim expired | "Your hold on this lead ended", then Back to queue: hero gone, lead row clickable again |

Differences from the mockup (not changed here): agent rows lack "x of 10 booked this week";
the checklist says "Saved on this device <time>" where the mockup says "Saved <time>"; fixture data differs.
