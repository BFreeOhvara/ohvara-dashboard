import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const b = await chromium.launch(); const p = await b.newPage()
for (const w of ['1440', '390']) for (const t of ['light', 'dark']) {
  const a = readFileSync(`qa/portal-parity-t6/billing-${w}-${t}-v1.png`).toString('base64')
  const m = readFileSync(`qa/portal-parity-t6/billing-${w}-${t}-master.png`).toString('base64')
  const r = await p.evaluate(async ([a, m]) => {
    const load = s => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s })
    const [A, M] = await Promise.all([load(a), load(m)])
    if (A.width !== M.width || A.height !== M.height) return { size: [A.width, A.height, M.width, M.height] }
    const px = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data }
    const da = px(A), dm = px(M); let diff = 0, minY = 1e9, maxY = -1
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i]-dm[i]) + Math.abs(da[i+1]-dm[i+1]) + Math.abs(da[i+2]-dm[i+2]) > 24) { diff++; const y = Math.floor(i / 4 / A.width); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
    return { size: [A.width, A.height], diffPx: diff, rows: diff ? [minY, maxY] : null }
  }, [a, m])
  console.log(w, t, JSON.stringify(r))
}
await b.close()
