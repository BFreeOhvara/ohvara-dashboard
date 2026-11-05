// P843 proof: (1) frame strips of the tab stretch on Leads, Activity and Settings (animations slowed 10x through
// DevTools, each frame a real moment of a real flight, the pill's edges read off its clip-path); (2) Overview,
// Clients, Activity, Settings, Submit a policy, Notifications open and Search open at 1440/390 x dark/light;
// (3) measures: glass panels, avatar hue = stage, clients per row, search field height, sign-out box, the drawer
// and menu exit, and Submit a policy end to end on the sample store. Writes qa/shell-843/.
//   node scripts/shell-shots-843.mjs [--base-url http://localhost:5173]
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || 'http://localhost:5173').replace(/\/$/, '')
const OUT = 'qa/shell-843'
mkdirSync(`${OUT}/stretch`, { recursive: true })
const report = { stretch: {}, measures: {}, errs: [], overflow: {}, submit: {} }
const b = await chromium.launch()
const theme = async (ctx, t) => ctx.addInitScript(x => { try { localStorage.setItem('theme', x); localStorage.setItem('ohvara-theme', x) } catch { /* private */ } }, t)
const watch = (p, tag) => {
  p.on('pageerror', e => report.errs.push(`${tag} ${e.message}`))
  p.on('console', m => { if (m.type() === 'error') report.errs.push(`${tag} ${m.text().slice(0, 160)}`) })
}

async function strip(p, name, rowSel, clickText) {
  const row = p.locator(rowSel).first()
  const cdp = await p.context().newCDPSession(p)
  await cdp.send('Animation.enable')
  await p.waitForTimeout(400)
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 })
  await p.locator(`${rowSel} > button:has-text("${clickText}")`).first().click()
  const frames = []
  for (let k = 0; k < 400; k++) {
    await p.waitForTimeout(60)
    const at = await p.evaluate(sel => {
      const layer = document.querySelector(`${sel} .sp-pill .sp-layer`)
      const anim = layer?.getAnimations()[0]
      if (!anim) return null
      const m = /inset\(([\d.]+)px calc\(100% - ([\d.]+)px\) calc\(100% - ([\d.]+)px\) ([\d.]+)px/.exec(getComputedStyle(layer).clipPath)
      return { t: Math.round(anim.currentTime), left: m ? +m[4] : null, right: m ? +m[2] : null }
    }, rowSel)
    if (!at) { if (frames.length) break; continue }
    if (!frames.length || at.t - frames.at(-1).t >= 30) {
      await row.screenshot({ path: `${OUT}/stretch/${name}-${String(at.t).padStart(3, '0')}.png` })
      frames.push(at)
    }
  }
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
  await p.waitForTimeout(300)
  await row.screenshot({ path: `${OUT}/stretch/${name}-end.png` })
  report.stretch[name] = frames
}

// 1. Stretch strips, dark, 1440
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await theme(ctx, 'dark')
  const p = await ctx.newPage()
  watch(p, 'strip')
  for (const [path, name, sel, first, to] of [
    ['leads', 'leads-all-to-live', '.tp-seg', null, 'Live calls'],
    ['activity', 'activity-today-to-all', '.tp-seg', 'Today', 'All'],
    ['settings', 'settings-profile-to-appearance', '.fx-ptabs', null, 'Appearance'],
  ]) {
    await p.goto(`${BASE}/template/${path}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    if (first) { await p.locator(`${sel} > button:has-text("${first}")`).first().click(); await p.waitForTimeout(900) }
    await strip(p, name, sel, to)
  }
  await ctx.close()
}

// 2. Screens + 3. measures
const PAGES = [['overview', ''], ['clients', 'clients'], ['activity', 'activity'], ['settings', 'settings'], ['submit', 'submit'], ['leads', 'leads']]
for (const t of ['dark', 'light']) {
  for (const w of [1440, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 } })
    await theme(ctx, t)
    const p = await ctx.newPage()
    watch(p, `${t} ${w}`)
    for (const [label, path] of PAGES) {
      await p.goto(`${BASE}/template/${path}`, { waitUntil: 'networkidle' })
      await p.waitForTimeout(2200)
      report.overflow[`${t}/${w}/${label}`] = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      report.measures[`${t}/${w}/${label}`] = await p.evaluate(() => {
        const vis = el => el.getBoundingClientRect().width > 0
        const panels = [...document.querySelectorAll('.fx .fx-tile:not(.is-fill), .fx .ov-card')].filter(vis)
        const glass = panels.map(el => { const cs = getComputedStyle(el); return [cs.backgroundColor, cs.backdropFilter !== 'none'] })
        const cards = [...document.querySelectorAll('.fx-card')].filter(vis).map(c => {
          const tone = c.className.match(/is-(blue|warn|teal|green|mute|violet)/)?.[1]
          const av = c.querySelector('.tp-av')
          return av ? [tone, av.className.match(/av-(\w+)/)?.[1]] : null
        }).filter(Boolean)
        const grid = document.querySelector('.fx-cgrid')
        const perRow = grid ? (() => { const kids = [...grid.children]; const top = Math.round(kids[0].getBoundingClientRect().top); return kids.filter(k => Math.round(k.getBoundingClientRect().top) === top).length })() : null
        const so = document.querySelector('.fx-signout')
        return {
          panels: panels.length, glassOff: glass.filter(g => !g[1]).length, panelFill: [...new Set(glass.map(g => g[0]))],
          cardAvatars: cards, perRow, signout: so ? [so.textContent.trim(), getComputedStyle(so).color] : null,
          signOutInPanel: [...document.querySelectorAll('.fx-panel button')].filter(x => /Sign out/.test(x.textContent)).length,
        }
      })
      if (label !== 'leads') await p.screenshot({ path: `${OUT}/${label}-${w}-${t}.png`, fullPage: w === 390 })
    }
    // Notifications open (bell top right on desktop, phone top on a phone)
    await p.goto(`${BASE}/template/`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1600)
    await p.locator('button[aria-label="Notifications"]:visible').first().click()
    await p.waitForTimeout(900)
    await p.screenshot({ path: `${OUT}/notifications-${w}-${t}.png` })
    const x = p.locator('.tp-layer .tp-sheet-h .fx-x').first()
    const xr = { cls: await x.getAttribute('class') }
    await x.hover(); await p.waitForTimeout(450)
    xr.hoverTransform = await x.evaluate(el => getComputedStyle(el).transform)
    await x.click()
    await p.waitForTimeout(60)
    xr.leaving = await p.evaluate(() => [!!document.querySelector('.tp-layer.is-leaving'), getComputedStyle(document.querySelector('.tp-layer.is-leaving .tp-sheet') || document.body).animationName])
    await p.waitForTimeout(80)
    xr.mid = await p.evaluate(() => { const el = document.querySelector('.tp-layer .tp-sheet'); return el ? [getComputedStyle(el).opacity, getComputedStyle(el).transform] : 'gone' })
    await p.waitForTimeout(400)
    xr.goneAfter = await p.evaluate(() => !document.querySelector('.tp-layer'))
    report.measures[`${t}/${w}/notifications-close`] = xr
    // Search open
    await p.locator(w === 390 ? '.tp-bar [aria-label="Search"]' : '.tp-rail [aria-label^="Search"]').first().click()
    await p.waitForTimeout(800)
    report.measures[`${t}/${w}/search`] = await p.evaluate(() => { const i = document.querySelector('.fx-pal-in'); const r = i.getBoundingClientRect(); return { field: Math.round(r.height), input: Math.round(i.querySelector('input').getBoundingClientRect().height) } })
    await p.screenshot({ path: `${OUT}/search-${w}-${t}.png` })
    await p.keyboard.press('Escape')
    await p.waitForTimeout(400)
    // Avatar menu: open, close, it plays out
    if (w === 1440) {
      await p.locator('.fx-tr .fx-me').first().click()
      await p.waitForTimeout(600)
      const red = await p.evaluate(() => { const r = [...document.querySelectorAll('.fx-menu .fx-mrow')].find(x => /Sign out/.test(x.textContent)); return r ? getComputedStyle(r.querySelector('b')).color : null })
      await p.screenshot({ path: `${OUT}/menu-${w}-${t}.png` })
      await p.keyboard.press('Escape')
      await p.waitForTimeout(90)
      const mid = await p.evaluate(() => { const el = document.querySelector('.fx-menu-layer .fx-menu'); return el ? [getComputedStyle(el).opacity, getComputedStyle(el).transform] : 'gone' })
      const leaving = await p.evaluate(() => getComputedStyle(document.querySelector('.fx-menu-layer.is-leaving .fx-menu') || document.body).animationName)
      await p.waitForTimeout(400)
      report.measures[`${t}/${w}/menu`] = { signOutColour: red, leaving, mid, goneAfter: await p.evaluate(() => !document.querySelector('.fx-menu-layer')) }
    }
    await ctx.close()
  }
}

// Clients per row across widths
for (const w of [1920, 1440, 1280, 1100, 900, 700, 390]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/template/clients`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  report.measures[`clients-per-row/${w}`] = await p.evaluate(() => { const g = document.querySelector('.fx-cgrid'); return getComputedStyle(g).gridTemplateColumns.split(' ').length + ' cols, card ' + Math.round(g.children[0].getBoundingClientRect().width) + 'px' })
  await ctx.close()
}

// 4. Submit a policy end to end on the sample store (what the agent shell writes today): steps, required fields,
// review, submit, the done screen, and the sale in Activity.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await theme(ctx, 'dark')
  const p = await ctx.newPage()
  watch(p, 'submit')
  await p.goto(`${BASE}/template/submit`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  const s = report.submit
  s.oldWords = await p.evaluate(() => /submitted this week|no weekly limit/i.test(document.body.innerText))
  await p.click('.fx-sub-f button:has-text("Next")')
  s.blockedWithoutName = await p.evaluate(() => [document.querySelector('.fx-sub-h h2').textContent, document.querySelectorAll('.fx-sub-body input.tp-danger').length])
  await p.fill('input[placeholder="First and last name"]', 'Test Policy Client')
  await p.fill('input[placeholder="(555) 555-0100"]', '(555) 555-0100')
  await p.click('.fx-sub-f button:has-text("Next")')
  await p.locator('.fx-sub-quick button:has-text("Harborline Life")').click()
  await p.screenshot({ path: `${OUT}/submit-step2-1440-dark.png` })
  await p.click('.fx-sub-f button:has-text("Next")')
  await p.waitForTimeout(400)
  s.review = await p.evaluate(() => document.querySelector('.fx-sub-review').innerText.replace(/\s+/g, ' '))
  await p.screenshot({ path: `${OUT}/submit-review-1440-dark.png` })
  await p.click('.fx-sub-f button:has-text("Submit policy")')
  await p.waitForTimeout(700)
  s.done = await p.evaluate(() => document.querySelector('.fx-sub-ok')?.innerText.split('\n').slice(0, 2).join(' | '))
  await p.screenshot({ path: `${OUT}/submit-done-1440-dark.png` })
  await p.click('a:has-text("See your clients")')
  await p.waitForTimeout(800)
  await p.goto(`${BASE}/template/activity`) // in-app store survives a client-side route only; check via the link instead
  s.note = 'store is in memory; the activity check below runs before any reload'
  await ctx.close()
}
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/template/submit`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.fill('input[placeholder="First and last name"]', 'Test Policy Client')
  await p.fill('input[placeholder="(555) 555-0100"]', '(555) 555-0100')
  await p.click('.fx-sub-f button:has-text("Next")')
  await p.fill('input[placeholder="Start typing a carrier"]', 'Pinecrest Assurance')
  await p.click('.fx-sub-f button:has-text("Next")')
  await p.click('.fx-sub-f button:has-text("Submit policy")')
  await p.waitForTimeout(500)
  await p.locator('nav.fx-tabs a:has-text("Activity")').click()
  await p.waitForTimeout(1200)
  report.submit.inActivity = await p.evaluate(() => [...document.querySelectorAll('.fx-feed-r')].some(r => /Test Policy Client/.test(r.textContent) && /Sale submitted/.test(r.textContent)))
  await ctx.close()
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1))
console.log(JSON.stringify({ errs: report.errs, overflow: Object.entries(report.overflow).filter(([, v]) => v > 0), submit: report.submit, stretch: Object.fromEntries(Object.entries(report.stretch).map(([k, v]) => [k, v.length])) }, null, 1))
await b.close()
