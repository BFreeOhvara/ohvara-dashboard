// P936 checks (sample previews): the one chart in every role, neutral to-do buttons, admin Clients without premium,
// the rail, the training gate, Lines & pods. 1440×900 and 1920×1080, light and dark, real clicks. Shots go to --out
// (one per view the spec names); measures print as PASS/FAIL lines.
//   node scripts/shell-936-checks.mjs --base-url http://localhost:4936 [--out qa/shell-936]
import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const BASE = (flag('--base-url') || '').replace(/\/$/, '')
const OUT = flag('--out') || 'qa/shell-936'
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const fails = []
const ok = (w, cond, m) => { if (cond) console.log(`PASS ${w}`); else { fails.push(`${w}: ${m}`); console.log(`FAIL ${w}: ${m}`) } }
const VIEWS = [{ w: 1440, h: 900 }, { w: 1920, h: 1080 }]
const settle = async p => { await p.waitForSelector('.ox-chart, .adm-ccard, .dn-card', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(1300) }

const chartState = page => page.evaluate(() => [...document.querySelectorAll('.ox-chart')].map(c => {
  const r = c.querySelector('.ox-plot').getBoundingClientRect()
  return { w: Math.round(r.width), h: Math.round(r.height), segs: c.querySelectorAll('path.ox-seg').length, area: c.querySelectorAll('.recharts-area-area').length,
    later: c.querySelectorAll('.ox-tick.is-later').length, cls: c.className }
}))
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

const browser = await chromium.launch()
for (const theme of ['light', 'dark']) {
  for (const v of VIEWS) {
    const tag = `${v.w}-${theme}`
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: theme, reducedMotion: 'no-preference' })
    await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* */ } }, theme)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error' && !/favicon|status of 40[34]|127\.0\.0\.1:1|ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|Failed to fetch/.test(m.text())) errors.push(m.text()) })

    // Admin Overview: three charts drawn, a tooltip on hover, future days faint, neutral to-do buttons
    await page.goto(`${BASE}/preview/admin`); await settle(page)
    let cs = await chartState(page)
    // the third (Leads by day) is the phone-only tile (admin.css), hidden on desktop
    cs = cs.filter(c => c.w > 0)
    ok(`${tag} admin overview charts`, cs.length === 2 && cs.every(c => c.segs > 0 && c.h > 60), JSON.stringify(cs))
    ok(`${tag} admin overview later days faint`, cs[0].later > 0, `later=${cs[0].later}`)
    const bar = page.locator('.adm-ov-hero path.ox-seg').first()
    await bar.hover(); await page.waitForTimeout(250)
    ok(`${tag} admin tooltip on hover`, await page.locator('.adm-ov-hero .ox-tip').isVisible(), 'no tooltip')
    const todo = await page.evaluate(() => [...document.querySelectorAll('.adm-todo')].map(r => {
      const b = r.querySelector('.adm-todo-go'); const bs = getComputedStyle(b); const rs = getComputedStyle(r)
      return { tone: r.className, row: rs.backgroundColor, bg: bs.backgroundColor, fg: bs.color, border: bs.borderTopWidth }
    }))
    const surface = await page.evaluate(() => getComputedStyle(document.querySelector('.tp')).getPropertyValue('--sh-surface').trim())
    ok(`${tag} admin to-do buttons neutral`, todo.length > 0 && new Set(todo.map(t => t.bg)).size === 1 && todo.every(t => t.border === '1px'), JSON.stringify(todo.slice(0, 3)) + surface)
    if (todo.length) {
      const b = page.locator('.adm-todo .adm-todo-go').first()
      const before = await b.evaluate(e => getComputedStyle(e).backgroundColor)
      await b.hover(); await page.waitForTimeout(250)
      const hover = await b.evaluate(e => getComputedStyle(e).backgroundColor)
      ok(`${tag} to-do button hover`, hover !== before, `${before} → ${hover}`)
    }
    ok(`${tag} admin overview no side scroll`, await noSideScroll(page), 'side scroll')
    await page.mouse.move(5, 5); await page.waitForTimeout(150)
    await page.screenshot({ path: `${OUT}/admin-overview-${tag}.png` })

    // Rail: no Training, Wording to approve, Carrier playbook; old addresses land on Overview
    const rail = await page.evaluate(() => [...document.querySelectorAll('.fx-ri')].map(a => a.getAttribute('aria-label')))
    ok(`${tag} rail`, !rail.some(l => /Training|Wording|Carrier playbook/.test(l)) && rail.includes('Deedstone numbers'), rail.join(', '))
    if (tag === '1440-light') {
      for (const k of ['wording', 'training', 'playbook']) {
        await page.goto(`${BASE}/preview/admin/${k}`); await page.waitForTimeout(600)
        ok(`old /admin/${k} lands on Overview`, new URL(page.url()).pathname === '/preview/admin', page.url())
      }
    }

    // Revenue by week
    await page.goto(`${BASE}/preview/admin/billing`); await settle(page)
    cs = await chartState(page)
    ok(`${tag} revenue chart`, cs.length >= 1 && cs[0].segs > 0 && (await page.locator('.adm-revweeks .ox-key li').count()) === 3, JSON.stringify(cs))
    await page.screenshot({ path: `${OUT}/admin-revenue-${tag}.png` })

    // Clients: no premium on any card
    await page.goto(`${BASE}/preview/admin/pipeline`); await settle(page)
    const cards = await page.evaluate(() => [...document.querySelectorAll('.adm-ccard')].map(c => c.innerText))
    ok(`${tag} clients cards without premium`, cards.length > 5 && cards.every(t => !/\$|\/mo|a month/.test(t)) && cards.every(t => /Drafts the|Draft day/.test(t) && /Sold /.test(t)), cards[0])
    ok(`${tag} clients no side scroll`, await noSideScroll(page), 'side scroll')
    await page.screenshot({ path: `${OUT}/admin-clients-${tag}.png` })

    // Lines & pods: one card per number, fits, slide-in with chart, Change VAs
    await page.goto(`${BASE}/preview/admin/numbers`); await settle(page)
    const fit = await page.evaluate(() => ({ cards: document.querySelectorAll('.dn-card').length, fits: document.documentElement.scrollHeight <= window.innerHeight + 2, inner: [...document.querySelectorAll('.adm-work *')].some(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2 }) }))
    ok(`${tag} lines & pods cards fit`, fit.cards === 3 && fit.fits && !fit.inner, JSON.stringify(fit))
    await page.screenshot({ path: `${OUT}/admin-lines-${tag}.png` })
    await page.locator('.dn-card-open').first().click(); await page.waitForTimeout(900)
    const drawer = await page.evaluate(() => ({ chart: document.querySelectorAll('.dn-detail path.ox-seg').length, sw: !!document.querySelector('.dn-detail .tp-switch, .dn-detail [role=switch]') }))
    ok(`${tag} lines & pods slide-in`, drawer.chart > 0, JSON.stringify(drawer))
    if (tag === '1440-light' || tag === '1440-dark') await page.screenshot({ path: `${OUT}/admin-lines-drawer-${tag}.png` })
    await page.keyboard.press('Escape'); await page.waitForTimeout(700)
    await page.locator('.dn-change').first().click(); await page.waitForTimeout(900)
    ok(`${tag} Change VAs opens the picker`, await page.locator('.dn-pod-pick').isVisible(), 'no picker')
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)

    // Agent Overview: Delivered chart; Needs you buttons neutral
    await page.goto(`${BASE}/template`); await settle(page)
    cs = await chartState(page)
    ok(`${tag} agent delivered chart`, cs.length >= 1 && (cs[0].segs > 0 || cs[0].area > 0) && cs[0].h > 100, JSON.stringify(cs))
    const nb = await page.evaluate(() => [...document.querySelectorAll('.fx-ncard')].map(c => { const b = c.querySelector('.tp-primary, .fx-accent'); return b ? [getComputedStyle(c).backgroundColor, getComputedStyle(b).backgroundColor, getComputedStyle(b).borderTopWidth] : null }).filter(Boolean))
    ok(`${tag} agent needs-you buttons neutral`, nb.length > 0 && new Set(nb.map(x => x[1])).size === 1 && nb.every(x => x[2] === '1px' && x[0] !== x[1]), JSON.stringify(nb.slice(0, 2)))
    ok(`${tag} agent no side scroll`, await noSideScroll(page), 'side scroll')
    await page.screenshot({ path: `${OUT}/agent-overview-${tag}.png` })

    // VA Overview: Hours chart, trained (no gate)
    await page.goto(`${BASE}/template/fulfillment`); await settle(page)
    cs = await chartState(page)
    ok(`${tag} VA hours chart`, cs.some(c => c.segs > 0), JSON.stringify(cs))
    ok(`${tag} VA trained: no gate`, (await page.locator('.fs-gate').count()) === 0, 'gate shown')
    await page.screenshot({ path: `${OUT}/va-overview-${tag}.png` })

    // Training gate: Maya's training reset → the gate shows, and the sample pick skips her
    if (theme === 'light' && v.w === 1440) {
      await page.evaluate(() => { localStorage.setItem('ful-training:v1', JSON.stringify({ people: { 'Maya Brooks': { results: {}, assigned: [] } }, edits: {} })) })
      await page.reload(); await settle(page)
      ok('VA in training sees the gate', (await page.locator('.fs-gate').innerText().catch(() => '')).includes('Finish training to start taking calls'), 'no gate')
      await page.screenshot({ path: `${OUT}/va-gate-${tag}.png` })
      const pick = await page.evaluate(async () => {
        const m = await import('/src/template/ful/data.js')
        const s = await import('/src/fulshell/training/store.js')
        return { trained: s.isTrained('Maya Brooks'), team: m.teamOn(m.atVa(2, '10:00 AM')).map(x => [x.id, x.trained]), pick: m.pickVa(2, '10:00 AM')?.id }
      })
      ok('untrained VA is never picked', pick.trained === false && pick.pick !== 'va-maya' && pick.team.find(x => x[0] === 'va-maya')?.[1] === false, JSON.stringify(pick))
      await page.evaluate(() => localStorage.removeItem('ful-training:v1'))
    }

    ok(`${tag} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }
}
await browser.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
