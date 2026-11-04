// P834: Solvik reference numbers + shots (public demo, read-only). node scripts/solvik-probe-834.mjs
import { chromium } from 'playwright'
const OUT = 'qa/shell-834'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
const go = async (route, theme) => {
  await page.goto(`https://demo.codeandchill.store/solvik/#/${route}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2000)
  const want = theme === 'light' ? 'Switch to light theme' : 'Switch to dark theme'
  const btn = page.locator(`[aria-label="${want}"]`)
  if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(1500) }
}
const measure = () => page.evaluate(() => {
  const cs = e => getComputedStyle(e)
  const bgOf = e => { while (e) { const c = cs(e).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; e = e.parentElement } return 'none' }
  const cur = document.querySelector('[aria-current="page"]')
  const card = [...document.querySelectorAll('h3, h4, p, span, div')].find(e => e.childElementCount === 0 && /Carport canopy|Battery storage retrofit/.test(e.textContent))
  let c = card; while (c && (cs(c).backgroundColor === 'rgba(0, 0, 0, 0)')) c = c.parentElement
  const rail = [...document.querySelectorAll('[aria-label="Create new"]')][0]?.closest('aside, nav, div')
  const railBox = rail?.getBoundingClientRect()
  const top = cur?.closest('nav')
  const ico = document.querySelector('[aria-label="Settings"] svg')
  return {
    activeTab: cur && `${cs(cur).backgroundColor} text ${cs(cur).color}`,
    body: `${cs(document.body).backgroundColor} | html ${cs(document.documentElement).backgroundColor} | bgImg ${cs(document.body).backgroundImage.slice(0, 80)}`,
    card: c && `${cs(c).backgroundColor} border ${cs(c).borderTopWidth} ${cs(c).borderTopColor} shadow ${cs(c).boxShadow.slice(0, 90)} title ${cs(card).color}`,
    rail: railBox && `${Math.round(railBox.width)}x${Math.round(railBox.height)}`, railIcon: ico && `${ico.getAttribute('width')}`,
    topNav: top && `${Math.round(top.getBoundingClientRect().width)}x${Math.round(top.getBoundingClientRect().height)}`,
  }
})
for (const theme of ['dark', 'light']) {
  for (const route of ['pipeline', 'overview']) {
    await go(route, theme)
    console.log(theme, route, JSON.stringify(await measure()))
    await page.screenshot({ path: `${OUT}/ref-${route}-1440-${theme}.png` })
  }
}
await b.close()
