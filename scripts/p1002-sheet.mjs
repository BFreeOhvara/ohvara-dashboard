// Contact sheet: node scripts/p1002-sheet.mjs <outPng> <img1> <img2> ... (each shown at ~half size, labelled)
import { chromium } from 'playwright'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileSync, rmSync } from 'node:fs'
const [out, ...imgs] = process.argv.slice(2)
const html = `<body style="margin:0;background:#888;display:flex;flex-wrap:wrap;gap:6px;padding:6px;font:11px sans-serif">${imgs.map(i => `<div style="width:243px"><div style="color:#fff">${basename(i, '.png')}</div><img src="${pathToFileURL(resolve(i)).href}" style="width:243px;display:block"></div>`).join('')}</body>`
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 100 } })
const f = resolve(out + '.html'); writeFileSync(f, html); await p.goto(pathToFileURL(f).href); await p.waitForTimeout(500)
await p.screenshot({ path: out, fullPage: true }); await b.close(); rmSync(f)
