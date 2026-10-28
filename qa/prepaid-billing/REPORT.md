# /agent/billing prepaid column: mocked-data screenshots

Run: `node scripts/prepaid-billing-shots.mjs` (Playwright + Vite dev server on a random port; the app is pointed at the
fake host `https://mock.supabase.co`, so no real project, account or credential is touched). Raw numbers: `measurements.json`.
Shots (`app-*.png`, `mockup-*.png`) are written next to this file.

Mocked REST calls: `agent_lead_balance` ($40.00), `lead_prices` ($30 Meta lead, $55 Google call), `prepaid_topup_options`
($100, $250, $500), `agent_lead_ledger` (6 rows: 2x Funds added, 4x Lead delivered, balance_after consistent row to row).
Each shot records which of the four calls the page made (all four, every time).

## Layout measurements (getBoundingClientRect, real output)

| shot | prepaid col | plan col | position | scrollWidth / clientWidth |
|---|---|---|---|---|
| main 1920 light + dark | 380 wide at x=1260.5, y=120 | 720 wide at x=520.5, y=120 | beside the plan (same top) | 1905 / 1920 |
| main 1440 light + dark | 380 wide at x=1020.5, y=120 | 720 wide at x=280.5, y=120 | beside the plan (same top) | 1425 / 1440 |
| main 390 light + dark | 358 wide at x=16, y=1472 | 358 wide at x=16, y=82 | under the plan (same left) | **390 / 390** |
| empty 1440 light / 390 dark | 380 beside / 358 under | same as main | | 1425/1440, 390/390 |
| low 1440 light / 390 dark | 380 beside / 358 under | same as main | | 1425/1440, 390/390 |
| loading 1440 light / 390 dark | 380 beside / 358 under | same as main | | 1425/1440, 390/390 |
| error 1440 light / 390 dark | 380 beside / 358 under | same as main | | 1425/1440, 390/390 |

- Column is **380px** beside the plan at 1440 and 1920 (done-means met). It sits under the plan at 390 (done-means met).
- At 390, `document.documentElement.scrollWidth == clientWidth == 390` in light and dark, and no element's right edge passes 390 (`maxRight` 390).
- The 1905/1920 and 1425/1440 desktop pairs are the 15px classic Windows scrollbar the page reserves (body is the scroller);
  no element goes past `clientWidth - 15` there (`maxRight` 1905 / 1425). A first 390 run in a desktop-style context read 375 / 390 for the same reason;
  the 390 shots use phone emulation (overlay scrollbars) as a real phone does.
- Balance font: `JetBrains Mono` in every shot; balance text `$40.00` (main), `$0.00` (empty), `$19.00` (low).
- No page errors in any shot.

## Compared with `ohvara/leads/mockups/billing-balance.html` (same sizes, light + dark)

Matches: order and placement (plan blocks left, balance hero / Price per lead / History right at wide; plan, bookings, plans,
then balance, price, history on a phone); hero + card surfaces and both themes; money in JetBrains Mono with cents;
history newest first with green `+` for funds and `−` for leads; Central-time wording ("Today, 4:17 PM", "Yesterday, …", "Oct 26, …");
loading keeps the three blocks with skeletons; error hides the two cards and keeps a Try again pill; no sideways scroll at 390.

Does not match (file as a separate frontend fix; I did not change app code in this task):

1. **Column width and page width.** Mockup: 400px column from 1180px content, page max 1280. App: 380px column (the done-means and
   `index.css` comment say 380) from 1040px container, page max 1120 (`BillingPanel.jsx` page wrapper). Decide which is right; the task says 380.
2. **Hero header.** Mockup: plain "Prepaid balance" label + status chip ("Receiving leads" / amber "Low balance" / neutral "No funds yet").
   App: a "Prepaid balance" chip with wallet icon, and a chip only when low. No "Receiving leads" or "No funds yet" chip.
3. **Hero line.** Mockup: "About 8 Meta leads or 4 Google calls at today's prices" and "Enough for 1 Meta lead, not a Google call" between prices.
   App: fixed sentence "Each lead is paid from this balance when it's delivered to you."
4. **Low-balance copy.** Mockup: "The next lead won't be delivered. Add funds to keep leads coming." App: "That's less than one lead ($30.00). Add funds to keep getting leads."
5. **Top-up buttons and Stripe line.** Mockup: 48px buttons, max 520px row, "Paid on Stripe's secure checkout, then back here" (one line). App: 46px (48 on phones), "Secure checkout by Stripe. Your card never touches Ohvara." wraps to two lines.
6. **Price per lead rows.** Mockup: icon tile, name, source line ("Form filled in from a Meta ad", "Call from a Google ad"), price 18px. App: name and price only (20px), no icon or source line; subtitle "Charged once, when a lead is delivered" vs "Taken from your balance when a lead is delivered to you."
7. **History rows.** Mockup: icon tile per row (green plus / phone / form), "Card top-up · …" under Funds added, "Balance $269.00". App: no icon tiles, no "Card top-up" text, "Bal. $40.00".
8. **Error card copy.** Mockup: "Balance isn't available right now." in an alert box. App: heading "We couldn't load your balance" + "Your money is safe. Check your connection and try again."
9. **Loading hero.** Mockup keeps the "Prepaid balance" label above the skeleton; app shows skeletons only.
10. **Low-balance chip in light mode.** The amber chip text is yellow-olive on the teal hero (mockup sets `--chip-warn-fg` to white in light); worth a contrast check.
11. **Back-from-Stripe notice.** Mockup: "Payment received. $250.00 was added to your prepaid balance." App: "Payment received. Your balance updates in a moment." (the app doesn't know the amount).

Not a defect: in the 390 full-page shots the fixed phone tab bar appears mid-image; that is Playwright full-page stitching of a `position: fixed` element.

## Fix pass: items 2-4 and 6-10 closed (rerun of the script)

Changed `PrepaidBalanceCard.jsx` and the `.ov-bal` / `.ov-bill-chip` rules in `index.css`; the error shot now waits for the new copy.
- 2: plain "Prepaid balance" label + chip: "Receiving leads", amber "Low balance", neutral "No funds yet".
- 3: hero line from `lead_prices` ("About N Meta leads or N Google calls at today's prices"; "Enough for 1 Meta lead, not a Google call.").
- 4: low copy "The next lead won't be delivered. Add funds to keep leads coming."
- 6: price rows have an icon tile, source line and an 18px price; subtitle matches the mockup. History rows have an icon tile (plus / phone / form),
  "Card top-up" under Funds added and "Balance $X".
- 7: error is "Balance isn't available right now." in an alert box. 8: the loading hero keeps the label.
- 9 (light chip): the amber chip text and dot are white on the teal hero via `--chip-warn-fg` / `--chip-warn-dot`.
- Column stays 380px. Still open: items 1, 5 and 11 (not in this task). History subtext wraps to two lines at 380 when it has a date and "Card top-up".
- At 390 (light and dark, every scenario) `scrollWidth == clientWidth == 390`; no page errors.
