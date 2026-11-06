// P853 QA: Connect page, live GoHighLevel tile in each state, on the sample preview with a temporary ?qa853=<state>
// hook (removed before commit). Run: node qa/admin-853/shots.mjs http://localhost:5853 qa/admin-853
import { chromium } from 'playwright'
const [,, base, out] = process.argv
const states = ['none', 'empty', 'wait', 'ok', 'err']
const b = await chromium.launch()
for (const [w, h] of [[1440, 900], [390, 844]]) for (const theme of ['dark', 'light']) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } })
  await ctx.addInitScript(t => localStorage.setItem('ohvara-theme', t), theme)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  p.on('console', m => m.type() === 'error' && !/CORS|ERR_FAILED|self-signup|Failed to load resource/.test(m.text()) && errs.push(m.text()))
  for (const s of states) {
    await p.goto(`${base}/preview/admin/connect?qa853=${s}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    const m = await p.evaluate(() => {
      const tile = document.querySelector('section[aria-label="GoHighLevel"]')
      const btn = [...tile.querySelectorAll('button')].find(x => x.textContent.includes('Test connection'))
      const save = [...tile.querySelectorAll('button')].find(x => x.textContent.trim() === 'Save')
      const inputs = [...tile.querySelectorAll('input')]
      return {
        sx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        chip: tile.querySelector('.tp-chip')?.textContent,
        sub: tile.querySelector('header p')?.textContent,
        testDisabled: btn.disabled, save: save.disabled,
        note: tile.querySelector('#ghl-test-note')?.textContent,
        selects: document.querySelectorAll('select').length,
        inputsDisabled: inputs.filter(i => i.disabled).length + '/' + inputs.length,
        keyType: tile.querySelector('input[aria-label="API key"]').type,
        keyShown: /A key is saved/.test(tile.textContent),
      }
    })
    const name = `connect-${s}-${w}-${theme}.png`
    await (await p.$('section[aria-label="GoHighLevel"]')).screenshot({ path: `${out}/${name}` })
    console.log(name, JSON.stringify(m), errs.length ? 'ERR ' + errs.join(' | ').slice(0, 200) : '')
    errs.length = 0
  }
  // Flow on the connected state: Test connection re-reads, an invalid ID blocks Save, a typed key is write-only.
  if (theme === 'dark') {
    await p.goto(`${base}/preview/admin/connect?qa853=ok`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    const tile = p.locator('section[aria-label="GoHighLevel"]')
    await tile.getByRole('button', { name: 'Test connection' }).click()
    await p.waitForTimeout(500)
    console.log('after test:', await p.locator('[role="status"], .tp-toast, [class*="toast"]').first().innerText().catch(() => '(no toast found)'))
    await tile.getByLabel('Workflow ID for no-show').fill('x')
    await p.waitForTimeout(200)
    console.log('bad id:', await tile.locator('.ad-err').innerText(), '| save disabled:', await tile.getByRole('button', { name: 'Save' }).isDisabled())
    await tile.getByLabel('Workflow ID for no-show').fill('abcdef-123456')
    await tile.getByLabel('API key').fill('pit-test-0000')
    console.log('valid id + key: save disabled:', await tile.getByRole('button', { name: 'Save' }).isDisabled())
    await tile.getByRole('button', { name: 'Save' }).click()
    await p.waitForTimeout(500)
    console.log('after save: key field value =', JSON.stringify(await tile.getByLabel('API key').inputValue()))
    await (await p.$('section[aria-label="GoHighLevel"]')).screenshot({ path: `${out}/flow-save-${w}-${theme}.png` })
  }
  await ctx.close()
}
await b.close()
