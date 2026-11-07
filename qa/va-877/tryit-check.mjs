// P877 Phase 2 — Try it on sample data: start it from the Speed to lead lesson, press Take it on a lead, the lesson
// is done and the next opens. Also the admin Training rows. node qa/va-877/tryit-check.mjs http://localhost:4877
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:4877'
const b = await chromium.launch()
const out = {}
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' })
  await ctx.route(/supabase\.co|\/functions\/v1\//, r => r.abort('failed'))
  // The sample VA has done the first five lessons, so Speed to lead (a Try it lesson) is up next.
  await ctx.addInitScript(() => {
    if (localStorage.getItem('ful-training:v1')) return
    const r = { pass: true, tried: true, at: '2026-11-02T15:00:00Z', tries: 1 }
    const done = { results: Object.fromEntries(['desk', 'never', 'optout', 'logging', 'inbound'].map(id => [id, r])), assigned: [] }
    localStorage.setItem('ful-training:v1', JSON.stringify({ people: Object.fromEntries(['Maya Brooks', 'Andre Lewis', 'Keisha Grant', 'Rosa Diaz', 'Jasmine Ortiz', 'Test Fulfill'].map(n => [n, done])), edits: {} }))
  })
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(String(e)))
  const m = {}
  await p.goto(`${BASE}/template/fulfillment/training/speed`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  m.cta = await p.locator('.tr-cta h2').innerText()
  await p.click('.tr-cta button:has-text("Try it now")'); await p.waitForTimeout(800)
  m.url1 = p.url().replace(BASE, '')
  m.bar = await p.locator('#tr-tryit').innerText().catch(() => null)
  m.barFits = await p.evaluate(() => { const r = document.getElementById('tr-tryit')?.getBoundingClientRect(); return r ? r.left >= 0 && r.right <= innerWidth : null })
  if (w === 1440) await p.screenshot({ path: 'qa/va-877/tryit-bar-1440.png' })
  await p.click('[aria-label="Open Shirley Adams"]'); await p.waitForTimeout(600)
  await p.click('.fx-rec button:has-text("Take it")'); await p.waitForTimeout(600)
  m.barAfter = await p.locator('#tr-tryit').innerText().catch(() => null)
  m.stored = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('ful-training:v1')); return { trying: s.trying, speed: Object.values(s.people)[0]?.results?.speed } })
  await p.goto(`${BASE}/template/fulfillment/training`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  m.rows = await p.$$eval('.tr-row', rs => rs.slice(0, 8).map(r => r.className.match(/is-(\w+)/)?.[1] + ':' + (r.querySelector('.tr-end')?.textContent || '')))
  m.overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  if (w === 1440) {
    await p.goto(`${BASE}/template/admin/settings`, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(800)
    m.adminUrl = p.url().replace(BASE, '')
  }
  m.errors = errs
  out[w] = m
  await ctx.close()
}
console.log(JSON.stringify(out, null, 1))
await b.close()
