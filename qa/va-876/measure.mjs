// P876 — numbers, not looks: the phone overlay never changes the page width; sliding it away mid-call keeps the call
// and lights the rail icon; no floating phone button; no dial-to-start; merge adds and drops; counts have no
// background; a bug report saves and reaches admin (list + bell).   node qa/va-876/measure.mjs http://localhost:4876
import { chromium } from 'playwright'
const BASE = process.argv[2]
const F = p => `${BASE}/template/fulfillment${p}`
const b = await chromium.launch()
const out = []
const say = (k, v) => { out.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`) }
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  const errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
  await p.goto(F(''), { waitUntil: 'load' }); await p.waitForTimeout(2200)
  const col = () => p.evaluate(() => { const c = document.querySelector('.fx-col'); const r = c.getBoundingClientRect(); return `${Math.round(r.left)}..${Math.round(r.right)} (${Math.round(r.width)})` })
  const tag = `${w}`
  say(`${tag} shift bar on Overview`, await p.locator('.fs-shift-top, :text("Request a day off")').count())
  say(`${tag} training bar on Overview`, await p.locator('.tr-nudge').count())
  say(`${tag} floating phone buttons (.fs-dock)`, await p.locator('.fs-dock').count())
  const before = await col()
  const icon = w >= 1000 ? '.fs-ri-phone' : '.fs-top-phone'
  await p.click(icon); await p.waitForTimeout(600)
  say(`${tag} column closed → open`, `${before} → ${await col()}`)
  say(`${tag} number entry or dial pad in idle phone`, await p.locator('.fs-call input[placeholder*="number" i], .fs-call .fs-pad').count())
  const callBtns = await p.locator('.fs-call .fs-ph-todo .fs-rb.is-go').count()
  say(`${tag} task Call buttons in phone`, callBtns)
  await p.locator('.fs-call .fs-ph-todo .fs-rb.is-go').first().click(); await p.waitForTimeout(1200)
  say(`${tag} in call`, await p.locator('.fs-call .fs-cs-timer').innerText())
  // merge: add the carrier, wait for it to answer, merge
  await p.click('.fs-call button[aria-label="Add a carrier or the agent to the call"]')
  await p.locator('.fs-cs-sheet .fx-mrow:has(svg.lucide-building2)').first().click()
  await p.waitForTimeout(2800)
  await p.click('.fs-call .fs-cs-merge')
  await p.waitForTimeout(300)
  say(`${tag} on the line after merge`, await p.locator('.fs-cs-line h3 .tp-num').innerText())
  await p.locator('.fs-cs-li .fs-cs-drop').last().click(); await p.waitForTimeout(200)
  say(`${tag} after drop: line list shown`, await p.locator('.fs-cs-line').count())
  await p.click('.fs-call button[aria-label="Hold"]'); await p.waitForTimeout(2100)
  say(`${tag} hold status`, await p.locator('.fs-cs-timer span').innerText())
  await p.click('.fs-call button[aria-label="Resume"]')
  // slide away mid-call
  await p.click('.fs-call-tab'); await p.waitForTimeout(700)
  say(`${tag} slid away: screen in view`, await p.evaluate(() => { const r = document.querySelector('.fs-call').getBoundingClientRect(); return r.left < innerWidth }))
  say(`${tag} slid away: rail icon`, await p.evaluate(s => { const e = document.querySelector(s); return `${e.className.match(/is-\w+/)?.[0]} timer=${e.querySelector('.fs-ri-time')?.textContent}` }, icon))
  say(`${tag} column after slide-away`, await col())
  await p.click(icon); await p.waitForTimeout(500)
  say(`${tag} back: still on the call`, await p.locator('.fs-call .fs-cs-timer').count())
  // count badges
  await p.goto(F('/pay'), { waitUntil: 'load' }); await p.waitForTimeout(1800)
  say(`${tag} Pay tab counts bg`, await p.evaluate(() => [...document.querySelectorAll('.fx-pt-n, .fx-tb')].map(e => `${e.textContent}:${getComputedStyle(e).backgroundColor}`).join(' ')))
  await p.goto(F('/training'), { waitUntil: 'load' }); await p.waitForTimeout(1800)
  say(`${tag} rail Training badge (active)`, await p.evaluate(() => { const e = document.querySelector('.fs-ri-train .fx-badge'); return e ? `${e.textContent}:${getComputedStyle(e).backgroundColor}` : 'none' }))
  say(`${tag} errors`, errs.length ? errs.join(' | ') : 'none')
  await p.close()
}
// bug report → admin
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
await p.goto(F('/pay'), { waitUntil: 'load' }); await p.waitForTimeout(1800)
await p.evaluate(() => localStorage.removeItem('ohvara-bug-reports:v1'))
await p.click('.fx-rail button[aria-label="Help and support"]')
await p.click('button:has-text("Report a bug")')
await p.fill('textarea >> nth=0', 'The Payouts tab shows a grey block on the 4')
await p.fill('textarea >> nth=1', 'Just the number')
await p.click('button:has-text("Send")'); await p.waitForTimeout(400)
say('bug sent', await p.locator(':text("Thanks, we\'ve got it.")').count())
await p.goto(`${BASE}/preview/admin/settings?tab=bugs`, { waitUntil: 'load' }); await p.waitForTimeout(2000)
say('admin list first row', (await p.locator('.adm-bugs li').first().innerText()).replace(/\n/g, ' | '))
await p.click('button[aria-label="Notifications"] >> nth=0').catch(() => {})
await p.waitForTimeout(500)
say('admin bell first', (await p.locator('.tp-list .tp-li').first().innerText().catch(() => 'none')).replace(/\n/g, ' | '))
await b.close()
console.log(out.join('\n'))
