// P844 proof: node qa/shell-844/shell-844-check.mjs --base-url http://localhost:5173   (a running dev server or preview)
import { chromium } from 'playwright'
const BASE = (process.argv[process.argv.indexOf('--base-url') + 1] || 'http://localhost:5173').replace(/\/$/, '')
const OUT = 'qa/shell-844'
const VIEWS = [{ w: 1440, h: 900, n: '1440' }, { w: 390, h: 844, n: '390' }]
const fails = []
const ok = (c, m) => { if (!c) fails.push(m); console.log(c ? 'ok  ' : 'FAIL', m) }
const browser = await chromium.launch()
for (const v of VIEWS) for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, reducedMotion: 'reduce' })
  await ctx.addInitScript(t => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ohvara-theme', t); sessionStorage.setItem('seeded', '1') } }, theme)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()) })
  const go = async p => { await page.goto(`${BASE}/template${p}`); await page.waitForTimeout(700) }
  const seg = name => page.locator('.tp-seg button', { hasText: new RegExp(`^${name}$`) }).first()
  const tag = `${v.n}-${theme}`
  // 1. Messages
  await go('/messages')
  const m = await page.evaluate(() => ({
    kpis: !!document.querySelector('.fx-kpis'), head: document.querySelector('.tp-head')?.getBoundingClientRect().height,
    threads: [...document.querySelectorAll('.tp-thread b')].map(b => b.textContent),
    convHead: document.querySelector('.tp-conv-h b')?.textContent, note: document.querySelector('.tp-conv-h small')?.textContent,
    ph: document.querySelector('.tp-conv-f input')?.placeholder,
  }))
  if (tag === '1440-dark') console.log(JSON.stringify(m))
  ok(!m.kpis && m.head <= 2, `${tag} messages: no title block or count line (head ${m.head}px, kpis ${m.kpis})`)
  ok(m.threads.length === 3 && m.threads.every(t => t.startsWith('About ')), `${tag} messages: thread rows read About <name>`)
  ok(/^Ohvara fulfillment · about /.test(m.convHead) && /client doesn.t see this/.test(m.note) && /^Message fulfillment about \w+…$/.test(m.ph), `${tag} messages: header, note, placeholder`)
  await page.screenshot({ path: `${OUT}/messages-${tag}.png` })
  // 2. Overview, four agents
  for (const a of ['established', 'new', 'first', 'empty']) {
    await go(`/?agent=${a}`)
    const o = await page.evaluate(() => ({
      range: document.querySelector('.fx-key-range')?.textContent, labels: [...document.querySelectorAll('.fx-wchart .fx-xs span')].map(s => s.textContent),
      bars: document.querySelectorAll('.fx-wchart .fx-bar').length, empty: /Nothing booked yet/.test(document.querySelector('.fx-ovl-hero')?.innerText || ''), band: !!document.querySelector('.fx-wchart .fx-band'),
    }))
    console.log(a, JSON.stringify(o))
    if (a === 'established') ok(o.range === 'Last 8 weeks' && o.labels.length === 8 && o.band, `${tag} overview established: last 8 weeks`)
    if (a === 'new') ok(o.range === 'Since you joined' && o.labels.length === 4 && o.labels[0] === 'Oct 12', `${tag} overview new: since joined, ${o.labels.join('/')}`)
    if (a === 'first') ok(/day by day/.test(o.range) && o.bars === 7 && !o.band && o.labels.includes('Today'), `${tag} overview first weeks: days`)
    if (a === 'empty') ok(o.empty && o.labels.length === 0, `${tag} overview empty: friendly empty state`)
    await page.screenshot({ path: `${OUT}/overview-${a}-${tag}.png` })
  }
  // 3. Calendar: day selected
  await go('/calendar')
  await page.locator('.fx-chip', { hasText: '4' }).first().click()
  await page.waitForTimeout(500)
  const c = await page.evaluate(() => { const on = document.querySelector('.fx-chip.is-on'); const b = on.querySelector('b'); return { day: b.textContent, bgA: getComputedStyle(b).backgroundColor } })
  console.log(JSON.stringify(c))
  ok(c.day === '4' && /rgba\(0, 0, 0, 0\)|transparent/.test(c.bgA), `${tag} calendar: selected day number has no grey box (${c.bgA})`)
  await page.screenshot({ path: `${OUT}/calendar-${tag}.png` })
  // 4. Appearance preview / save / discard / leave
  await go('/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.waitForTimeout(400)
  const attr = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const stored = () => page.evaluate(() => localStorage.getItem('ohvara-theme'))
  const other = theme === 'dark' ? 'Light' : 'Dark'
  await page.screenshot({ path: `${OUT}/appearance-before-${tag}.png` })
  ok((await attr()) === theme, `${tag} appearance: starts ${theme}`)
  await seg(other).click()
  await page.waitForTimeout(300)
  ok((await attr()) === other.toLowerCase() && (await stored()) === theme, `${tag} appearance: ${other} previews at once, nothing saved yet`)
  await page.screenshot({ path: `${OUT}/appearance-preview-${tag}.png` })
  await page.getByRole('button', { name: 'Discard' }).click()
  await page.waitForTimeout(200)
  ok((await attr()) === theme, `${tag} appearance: Discard puts ${theme} back`)
  await seg(other).click()
  await page.getByRole('tab', { name: 'Profile' }).click()
  await page.waitForTimeout(300)
  ok((await attr()) === theme, `${tag} appearance: leaving the tab unsaved puts ${theme} back`)
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await seg(other).click()
  await page.goto(`${BASE}/template/`) // a full load would reset it anyway; use the in-app link instead
  await go('/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await seg(other).click()
  await page.getByRole('link', { name: 'Clients' }).first().click()
  await page.waitForTimeout(500)
  ok((await attr()) === theme, `${tag} appearance: leaving Settings unsaved puts ${theme} back`)
  await go('/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await seg(other).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForTimeout(300)
  ok((await attr()) === other.toLowerCase() && (await stored()) === other.toLowerCase(), `${tag} appearance: Save keeps ${other}`)
  await seg('System').click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  ok((await stored()) === 'system', `${tag} appearance: System saves`)
  await page.screenshot({ path: `${OUT}/appearance-system-${tag}.png` })
  ok(errs.length === 0, `${tag} no console errors ${errs.slice(0, 2).join(' | ')}`)
  await ctx.close()
}
await browser.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
