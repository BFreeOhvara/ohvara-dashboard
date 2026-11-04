import { chromium } from 'playwright'
const [,, base, out, ...routes] = process.argv
const views = (process.env.VIEWS || '1440x900').split(',').map(v => v.split('x').map(Number))
const themes = (process.env.THEMES || 'dark').split(',')
const b = await chromium.launch()
for (const [w, h] of views) for (const theme of themes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } })
  await ctx.addInitScript(t => localStorage.setItem('ohvara-theme', t), theme)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
  for (const r of routes) {
    const [path, act] = r.split('@')
    await p.goto(base + path, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1600)
    if (act === 'k') { await p.keyboard.press('Control+k'); await p.keyboard.type('or'); await p.waitForTimeout(700) }
    if (act === 'menu') { await p.click('.fx-me:visible'); await p.waitForTimeout(600) }
    const sx = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const name = `${path.replace(/\W+/g, '_')}${act ? '-' + act : ''}-${w}-${theme}.png`
    await p.screenshot({ path: `${out}/${name}`, fullPage: process.env.FULL === '1' })
    console.log(name, 'sx=' + sx, errs.length ? 'ERR ' + errs.join(' | ').slice(0, 200) : '')
    errs.length = 0
  }
  await ctx.close()
}
await b.close()
