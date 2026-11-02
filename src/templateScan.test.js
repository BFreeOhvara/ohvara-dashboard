import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The clickable template must stay a sample-only page: no backend words, no hex colors, no brand names in visible text.
// It sits outside src/template so its own patterns are not scanned. The noindex tag code is the one allowed hit.
const ROOT = new URL('./template', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const walk = dir => readdirSync(dir).flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const files = walk(ROOT).filter(f => /\.(jsx?|css)$/.test(f))

const RULES = [
  ['supabase', /supabase/i],
  ['useQuery', /useQuery/],
  ['fetch(', /fetch\(/],
  ['a hex color', /#[0-9a-fA-F]{3,8}\b/],
  ['a brand name (Meta, Google, Facebook)', /meta|google|facebook/i],
  ['the word inbound', /inbound/i],
]

test('the template folder has files to scan', () => {
  assert.ok(files.length > 15, `found ${files.length} files`)
})

test('src/template holds only sample-only code', () => {
  const hits = []
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const [why, re] of RULES) {
        if (!re.test(line)) continue
        const allowed = why.startsWith('a brand') && /TemplateApp\.jsx$/.test(f) && /createElement\('meta'\)/.test(line)
        if (!allowed) hits.push(`${f.slice(ROOT.length)}:${i + 1} ${why}: ${line.trim().slice(0, 80)}`)
      }
    })
  }
  assert.deepEqual(hits, [])
})
