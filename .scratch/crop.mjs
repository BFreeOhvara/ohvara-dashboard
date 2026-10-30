import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const [src, out, y, h] = process.argv.slice(2)
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: Number(h) } })
await p.setContent(`<body style="margin:0"><img src="data:image/png;base64,${readFileSync(src).toString('base64')}" style="display:block;margin-top:-${y}px">`)
await p.screenshot({ path: out }); await b.close()
