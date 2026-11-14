// P1002 follow-up — desktop proof (1440x900): Carriers + Privacy on Settings, the client drawer's Timeline / Where from /
// Send app link, Calendar Month, Leads "Can't make it", Help FAQ. BASE=... node scripts/p1002-desktop.mjs <outDir> [light|dark]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const BASE = process.env.BASE || 'http://localhost:5002'
const OUT = process.argv[2] || 'qa/p1002d'; const scheme = process.argv[3] || 'light'
mkdirSync(OUT, { recursive: true })
const res = {}
const browser = await chromium.launch()
const click = (t, loose) => async p => {
  const ok = await p.evaluate(([t, loose]) => {
    const els = [...document.querySelectorAll('button,a,[role=button],[role=tab],summary,div,span,b,h3,li')]
    const vis = e => !e.closest('[inert]') && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'
    const own = e => (e.getAttribute('aria-label') || [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('') || e.textContent || '').trim()
    const hit = els.filter(vis).find(e => { const x = own(e); return loose ? x.startsWith(t) : x === t }) || els.filter(vis).find(e => (e.textContent || '').trim() === t)
    if (!hit) return false
    hit.click(); return true
  }, [t, loose])
  if (!ok) throw new Error(`no visible "${t}"`)
}
const scrollDrawer = y => p => p.evaluate(v => { for (const el of document.querySelectorAll('.fx-rec, .fx-rec-body, [role=dialog], .tp-drawer, aside')) { if (el.scrollHeight > el.clientHeight + 20) el.scrollTo(0, v) } }, y)
async function flow(name, url, steps) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
  const p = await ctx.newPage(); const errors = []
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|127\.0\.0\.1:1/.test(m.text())) errors.push(m.text().slice(0, 160)) })
  p.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  await p.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1000)
  let n = 0
  for (const [label, fn] of steps) {
    try { await fn(p) } catch (e) { errors.push(`step "${label}": ${String(e).slice(0, 110)}`) }
    await p.waitForTimeout(700)
    await p.screenshot({ path: join(OUT, `${name}-${++n}-${label}-${scheme}.png`) })
    res[`${name}-${n}-${label}`] = await p.evaluate(() => ({ ox: document.documentElement.scrollWidth - innerWidth }))
  }
  res[`${name}-errors`] = errors
  await ctx.close()
}
await flow('settings', '/template/settings', [['profile', async () => {}], ['removed', p => p.locator('button[aria-label^="Remove "]').first().click()]])
await flow('client', '/template/clients/sample-client-1', [['drawer', async () => {}], ['below', scrollDrawer(2000)], ['applink', click('Send app link')]])
await flow('calendar', '/template/calendar', [['week', async () => {}], ['month', click('Month')], ['nextmonth', click('Next month')]])
await flow('leads', '/template/leads/sample-lead-1', [['drawer', async () => {}], ['cant', click('Can’t make it')]])
await flow('help', '/template', [['home', async () => {}], ['help', click('Help and support')], ['open', p => p.locator('.fx-faq summary').first().click()]])
await browser.close()
writeFileSync(join(OUT, `desk-${scheme}.json`), JSON.stringify(res, null, 1))
for (const [k, v] of Object.entries(res)) { if (k.endsWith('errors') ? v.length : v.ox > 0) console.log('FLAG', k, JSON.stringify(v).slice(0, 300)) }
console.log('done', Object.keys(res).length)
