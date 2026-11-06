// P867 — before/after peek table from the scroll check's JSON: node qa/scroll-867/table.mjs base final > table.md
import { readFileSync } from 'node:fs'

const [before, after] = process.argv.slice(2).map(d => ['admin', 'agent', 'va'].flatMap(p => JSON.parse(readFileSync(new URL(`./${d}/${p}.json`, import.meta.url), 'utf8'))))
const SIZES = ['1366x768', '1440x900', '1536x864', '1920x1080', '390x844']
const cell = r => !r ? '–' : !r.scrolls ? 'fits' : `${r.ok ? '' : '✗ '}${r.share == null ? 'gap' : Math.round(r.share * 100) + '%'}`
const pages = [...new Set(after.map(r => `${r.portal} ${r.page}`))]
console.log(`| page | ${SIZES.join(' | ')} |`)
console.log(`|---|${SIZES.map(() => '---').join('|')}|`)
for (const p of pages) {
  const row = SIZES.map(s => {
    const f = r => `${r.portal} ${r.page}` === p && r.size === s
    const b = before.find(f), a = after.find(f)
    return cell(b) === cell(a) ? cell(a) : `${cell(b)} → ${cell(a)}`
  })
  console.log(`| ${p} | ${row.join(' | ')} |`)
}
const fails = after.filter(r => !r.ok)
console.log(`\n${after.length} checks, ${fails.length} failure(s) (before: ${before.filter(r => !r.ok).length})`)
