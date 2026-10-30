import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const cases = {
  literal: "const x = 'New inbound'\n",
  jsx: "export const A = () => <p>Your inbounds</p>\n",
  aria: "export const B = () => <nav aria-label=\"Inbound type\" />\n",
  code: "export const C = { kind: 'inbound', source: 'inbound', p: 'inbound_product', r: `/agent/inbounds/${1}` }\n// an inbound comment\n",
}
for (const [k, src] of Object.entries(cases)) {
  const d = mkdtempSync(join(tmpdir(), 'vw-'))
  mkdirSync(join(d, 'src'))
  writeFileSync(join(d, 'src', 'p.jsx'), src)
  const r = spawnSync(process.execPath, [process.argv[2]], { cwd: d, encoding: 'utf8' })
  console.log(k, 'rc=' + r.status, (r.stderr + r.stdout).split('\n').filter(l => /p\.jsx|passed/.test(l)).join(' | '))
  rmSync(d, { recursive: true, force: true })
}
