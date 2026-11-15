// P1018 proof: the Connect checklist (empty, half done, all done) desktop + phone, light + dark, and Messages
// for admin, VA desktop and VA phone (sample).   node scripts/p1018-shots.mjs <outdir>   (sample-mode dev server)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const BASE = process.env.BASE || 'http://localhost:5018'
const OUT = process.argv[2] || 'qa/p1018'
mkdirSync(OUT, { recursive: true })
const VALS = ['ve9EPM428h8vShlRW1KT', 'pit-1f2e3d4c-5b6a-4789-9abc-def012345678', null, null, null, null,
  'a1b2c3d4-0000-4000-8000-000000000001', 'a1b2c3d4-0000-4000-8000-000000000002', 'https://services.leadconnectorhq.com/hooks/ve9EPM428h8vShlRW1KT/webhook-trigger/abc123']
async function fill(p, from, to) {
  await p.evaluate(async ([from, to, vals]) => {
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    for (let i = from; i < to; i++) {
      const card = document.querySelectorAll('.cn-step')[i]
      const btn = t => [...card.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t))
      const inp = card.querySelector('input:not([type=checkbox])')
      if (btn('Make one')) { btn('Make one').click(); await wait(120) } else if (inp && vals[i]) { set(inp, vals[i]); await wait(60) }
      if (btn('Save') && !btn('Save').disabled) { btn('Save').click(); await wait(500) }
      if (btn('Test')) { btn('Test').click(); await wait(700) }
    }
  }, [from, to, VALS])
}
const rows = []
const b = await chromium.launch()
for (const [w, h] of [[1440, 900], [390, 844]]) for (const scheme of ['light', 'dark']) {
  const phone = w < 500
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: phone, isMobile: phone })
  await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch {} }, scheme)
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)))
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|127\.0\.0\.1:1/.test(m.text())) errs.push(m.text().slice(0, 140)) })
  const tag = `${phone ? 'phone' : 'desktop'}-${scheme}`
  await p.goto(BASE + (phone ? '/preview/admin?s=setup' : '/preview/admin/connect'), { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1200)
  for (const [state, from, to] of [['empty', 0, 0], ['half', 0, 4], ['all', 4, 9]]) {
    await fill(p, from, to); if (state === 'all') await fill(p, 0, 9)
    await p.waitForTimeout(300)
    const r = await p.evaluate(() => ({
      prog: document.querySelector('.cn-page h2, .cn-prog h2, [class*=cn-prog]')?.textContent?.match(/\d+ of \d+/)?.[0],
      cards: document.querySelectorAll('.cn-step').length, ticks: document.querySelectorAll('.cn-step.is-done').length,
      optional: /optional/i.test(document.body.innerText), ox: document.documentElement.scrollWidth - innerWidth,
    }))
    rows.push({ shot: `connect-${state}-${tag}`, ...r, errors: errs.length })
    await p.evaluate(() => window.scrollTo(0, 0))
    await p.screenshot({ path: `${OUT}/connect-${state}-${tag}.png`, fullPage: !phone })
  }
  const msgs = phone ? [['admin', '/preview/admin/messages'], ['va', '/template/fulfillment/messages']] : [['admin', '/preview/admin/messages'], ['va', '/template/fulfillment/messages']]
  for (const [who, path] of msgs) {
    errs.length = 0
    await p.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1200)
    const r = await p.evaluate(() => ({ rows: [...document.querySelectorAll('.tp-thread b, .ma-thread b, .ma-row b')].map(e => e.textContent).slice(0, 12).join(' | '), ox: document.documentElement.scrollWidth - innerWidth }))
    rows.push({ shot: `messages-${who}-${tag}`, ...r, errors: errs.length })
    await p.screenshot({ path: `${OUT}/messages-${who}-${tag}.png` })
  }
  await ctx.close()
}
await b.close()
console.log(JSON.stringify(rows, null, 1))
