// P949 checks (sample previews, agent side + admin to-do): status colours, one Still-on-the-books box, the agent
// Overview chart, Your states (limits, tick, admin to-do), Change plan text whole, the Booking desk card, the calendar
// hover + lead pop-up. 1440×900 and 1920×1080, light and dark, real clicks. Shots go to --out; PASS/FAIL lines.
//   node scripts/shell-949-checks.mjs --base-url http://localhost:4949 [--out qa/shell-949]
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/shell-949'
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const fails = []
const ok = (w, cond, m) => { if (cond) console.log(`PASS ${w}`); else { fails.push(`${w}: ${m}`); console.log(`FAIL ${w}: ${m}`) } }
const VIEWS = [{ w: 1440, h: 900 }, { w: 1920, h: 1080 }]
const settle = p => p.waitForTimeout(1500)
// "dark" = a fill darker than mid-grey with light ink: the darkened variant that must be gone
const fillOf = (page, sel) => page.$$eval(sel, els => els.map(e => {
  const s = getComputedStyle(e)
  const n = c => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
  const l = c => { const [r, g, b] = n(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  return { t: e.textContent.trim().slice(0, 18), bg: l(s.backgroundColor), ink: l(s.color) }
}))
const noDark = list => list.every(x => x.bg > 120 && x.ink < 110)

const browser = await chromium.launch()
for (const theme of ['light', 'dark']) {
  for (const v of VIEWS) {
    const tag = `${v.w}-${theme}`
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme })
    await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t); if (!sessionStorage.getItem('p949-reset')) { localStorage.removeItem('ohvara-state-changes:v1'); sessionStorage.setItem('p949-reset', '1') } } catch { /* */ } }, theme)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const shot = async name => { if (v.w === 1440) await page.screenshot({ path: `${OUT}/${name}-${tag}.png` }) }

    // 1. Status colours: live call cards, the lead pop-up's status buttons, the result picker
    await page.goto(`${BASE}/template/leads`); await settle(page)
    const live = await fillOf(page, '.lv-res')
    ok(`${tag} live-call buttons light fills`, live.length && noDark(live), JSON.stringify(live.slice(0, 3)))
    await shot('leads')
    await page.click('a[href$="/leads/sample-lead-7"]'); await page.waitForTimeout(900)
    const pop = await fillOf(page, '.fx-rec .is-res')
    ok(`${tag} lead pop-up status buttons light fills`, pop.length >= 3 && noDark(pop), JSON.stringify(pop))
    await page.click('.fx-rec .fx-step.is-res.is-teal'); await page.waitForTimeout(800)
    const picked = await fillOf(page, '.rs-opt.is-on')
    ok(`${tag} result picker light fill`, picked.length === 1 && noDark(picked), JSON.stringify(picked))
    await shot('lead-picker')

    // 2. One Still-on-the-books box with the range
    await page.goto(`${BASE}/template/clients`); await settle(page)
    const box = await page.evaluate(() => ({ n: document.querySelectorAll('.ck-list').length, q: document.querySelector('[data-check-q]')?.textContent }))
    ok(`${tag} one check box with a range`, box.n === 1 && /drafted Oct 27 – Nov 1\./.test(box.q || ''), JSON.stringify(box))
    await shot('clients-check')

    // 3. Agent Overview chart = the P936 one; admin keeps the area chart
    await page.goto(`${BASE}/template`); await settle(page)
    const ov = await page.evaluate(() => ({ chart: !!document.querySelector('.fx-ovl-hero .ox-chart.fx-dchart'), area: !!document.querySelector('.fx-ovl-hero .ox-trend-plot'), key: !!document.querySelector('.fx-ovl-hero .fx-key') }))
    ok(`${tag} agent Overview chart restored`, ov.chart && !ov.area && ov.key, JSON.stringify(ov))
    await shot('agent-overview')

    // 4–6. Billing: Change plan whole, Booking desk card, Your states
    await page.goto(`${BASE}/template/billing`); await settle(page)
    const desk = await page.evaluate(() => { const s = document.querySelector('[aria-label="Booking desk"]'); const p = document.querySelector('[aria-label="Paid ahead"]'); return s && p ? { text: s.textContent, under: s.getBoundingClientRect().top > p.getBoundingClientRect().bottom, sameX: Math.abs(s.getBoundingClientRect().left - p.getBoundingClientRect().left) < 2 } : null })
    ok(`${tag} Booking desk card under Paid ahead`, desk && desk.under && desk.sameX && /12% of your ad spend/.test(desk.text) && /grows with your spend/.test(desk.text), JSON.stringify(desk))
    await page.getByRole('button', { name: 'Change plan' }).click(); await page.waitForTimeout(900)
    const plan = await page.evaluate(() => {
      const cut = [...document.querySelectorAll('.tp-layer *')].filter(e => !e.children.length && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map(e => e.textContent.trim())
      const night = [...document.querySelectorAll('.bl-night dd > *')].map(e => e.textContent)
      return { cut, night }
    })
    ok(`${tag} Change plan: nothing cut, nightly line whole`, plan.cut.length === 0 && plan.night.join(' · ') === '$112 a night · $100 to your ads · $12 booking desk', JSON.stringify(plan))
    await shot('change-plan')
    await page.keyboard.press('Escape'); await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'Your states' }).click(); await page.waitForTimeout(800)
    const st = c => page.locator('.st-grid .wz-state', { hasText: new RegExp(`^${c}$`) })
    const save = page.locator('[data-states-save]')
    ok(`${tag} NY can't be picked`, await st('NY').isDisabled(), 'NY enabled')
    await st('GA').click(); await st('FL').click()
    ok(`${tag} fewer than 3 blocked`, await save.isDisabled() && /at least 3/.test(await page.locator('[data-states-why]').textContent()), 'saved with 2')
    await st('GA').click(); await st('FL').click()
    for (const c of ['NC', 'CO', 'OH', 'MI', 'PA', 'WA']) await st(c).click()
    ok(`${tag} 10 max`, await st('UT').isDisabled(), 'UT still pickable at 10')
    ok(`${tag} added states need the tick`, await save.isDisabled() && await page.locator('[data-states-tick]').isVisible(), 'no tick')
    for (const c of ['CO', 'OH', 'MI', 'PA', 'WA']) await st(c).click()
    await st('AZ').click()
    await page.locator('[data-states-tick] input').check()
    ok(`${tag} +NC −AZ saves`, !(await save.isDisabled()) && /\+NC, −AZ/.test(await page.locator('[data-states-diff]').textContent()), 'cannot save')
    await shot('your-states')
    await save.click(); await page.waitForTimeout(900)
    ok(`${tag} plan row shows the new states`, /FL, GA, NC, TX/.test(await page.locator('[data-row=states]').textContent()), 'row not updated')
    await shot('billing')
    await page.goto(`${BASE}/preview/admin`); await settle(page)
    const more = page.getByRole('button', { name: /Show all/ })
    if (await more.count()) await more.first().click()
    const todo = await page.locator('.adm-todo', { hasText: 'Update ad states for' }).textContent({ timeout: 3000 }).catch(() => '')
    ok(`${tag} admin to-do`, /Update ad states for Dana Walker: \+NC, −AZ/.test(todo), todo)
    ok(`${tag} admin Overview keeps the area chart`, await page.locator('.adm-ov .ox-trend-plot').count() > 0, 'no area chart')

    // 7. Calendar: no tinted today, Today pill, hover lifts the box, a booking opens the Leads pop-up
    await page.goto(`${BASE}/template/calendar`); await settle(page)
    const cal = await page.evaluate(() => ({ tint: getComputedStyle(document.querySelector('.tp-tcol.today')).backgroundColor, pill: document.querySelector('.fx-week b.today small')?.textContent }))
    ok(`${tag} no highlighted today column, Today label`, /rgba\(0, 0, 0, 0\)|transparent/.test(cal.tint) && cal.pill === 'Today', JSON.stringify(cal))
    const ev = page.locator('.tp-ev.lead', { hasText: 'Owen Price' })
    await ev.hover(); await page.waitForTimeout(400)
    const lift = await ev.evaluate(e => getComputedStyle(e).translate)
    ok(`${tag} call box lifts on hover`, /-3px/.test(lift), lift)
    await ev.click(); await page.waitForTimeout(900)
    const rec = await page.evaluate(() => { const r = document.querySelector('.fx-rec'); return r && { h: r.querySelector('h2')?.textContent, blocks: [...r.querySelectorAll('h3')].map(h => h.textContent), cant: !!r.querySelector('[data-cant]') } })
    ok(`${tag} booking opens the Leads pop-up`, rec && rec.h === 'Owen Price' && rec.blocks.includes('Messages') && rec.cant, JSON.stringify(rec))
    await shot('calendar-popup')

    ok(`${tag} no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}
await browser.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
