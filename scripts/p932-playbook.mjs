// P932 — writes the carrier playbook from src/lib/servicing/playbookData.js into
//   1. migration 262's seed block (insert … on conflict do nothing, so saved edits on live are never overwritten)
//   2. migration 262's route_tick block (236's route_tick with section g giving hold-line callers max_wait_min)
//   3. the vault note brain/ohvara/Carrier Playbook.md (pass --vault <path to obsidian-mind>)
//   node scripts/p932-playbook.mjs [--vault ../obsidian-mind]
import { readFileSync, writeFileSync } from 'node:fs'
import { PLAYBOOK, ACTIONS, PLAYBOOK_CHECKED } from '../src/lib/servicing/playbookData.js'
import { CARRIER_CATALOG } from '../src/lib/carriers/catalog.js'
import { normalizeName } from '../src/lib/carriers.js'
import { METHOD, ACTION_WORD, VIA_WORD, hoursLine } from '../src/lib/servicing/playbook.js'

const MIG = 'supabase/migrations/262_carrier_playbook.sql'
const q = v => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const arr = a => `array[${(a || []).map(q).join(', ')}]::text[]`
const ESIGN = { yes: 'yes', no: 'no' }

const rows = []
for (const p of PLAYBOOK) {
  const c = CARRIER_CATALOG.find(x => x.id === p.key)
  const names = [...new Set([c.name, ...c.aliases].map(normalizeName).filter(Boolean))]
  for (const a of ACTIONS) {
    const s = p.actions[a]
    rows.push(`(${[q(p.key), q(c.name), arr(names), q(a), q(s.method), q(ESIGN[s.esign] || 'unknown'), q(s.form), q(s.url), q(s.via), q(s.to),
      q(p.phone), arr(s.have), q(s.notes), q(p.source), q(PLAYBOOK_CHECKED), q(s.method === 'check' || s.confirmed === false ? 'check' : 'confirmed')].join(', ')})`)
  }
}
const seed = `insert into public.carrier_playbook (carrier_key, carrier_name, names, action, method, esign_accepted, form_name, form_url,
  send_via, send_to, phone, have_ready, notes, source_url, checked_on, status) values
${rows.join(',\n')}
on conflict (carrier_key, action) do nothing;`

// 236's route_tick, section g changed.
const src = readFileSync('supabase/migrations/236_calling_engine.sql', 'utf8').split('\n')
const start = src.findIndex(l => l.startsWith('create or replace function public.route_tick()'))
const end = src.findIndex((l, i) => i > start && l.startsWith('$$;'))
let tick = src.slice(start, end + 1).join('\n')
const OLD = "where q.kind = 'inbound' and q.status in ('waiting', 'offered') and q.ready_at < now() - interval '2 minutes' loop"
if (!tick.includes(OLD)) throw new Error('route_tick section g changed: update scripts/p932-playbook.mjs')
tick = tick.replace('-- g. Inbound callers nobody took in 2 minutes: help-voice ends the wait and they become a callback.',
  '-- g. Inbound callers nobody took in 2 minutes: help-voice ends the wait and they become a callback.\n' +
  '  --    P932: a caller on the hold line waits up to max_wait_min (help-voice books their callback itself);\n' +
  '  --    this only catches one help-voice lost (2 minutes past it).')
tick = tick.replace(OLD, "where q.kind = 'inbound' and q.status in ('waiting', 'offered')\n" +
  "              and q.ready_at < now() - case when coalesce((q.detail ->> 'hold_line')::boolean, false)\n" +
  "                then make_interval(mins => coalesce((select max_wait_min from public.hold_line_settings where id = 1), 10) + 2)\n" +
  "                else interval '2 minutes' end loop")
tick += '\nrevoke execute on function public.route_tick() from public, anon, authenticated;'

let mig = readFileSync(MIG, 'utf8')
const put = (m, a, b, body) => m.replace(new RegExp(`(-- ${a}[^\\n]*\\n)[\\s\\S]*?(-- ${b})`), (_, x, y) => `${x}${body}\n${y}`)
mig = put(mig, 'ROUTE_TICK:BEGIN', 'ROUTE_TICK:END', tick)
mig = put(mig, 'SEED:BEGIN', 'SEED:END', seed)
writeFileSync(MIG, mig)
console.log(`seed: ${rows.length} rows (${PLAYBOOK.length} carriers); route_tick copied (${end - start + 1} lines)`)

const vi = process.argv.indexOf('--vault')
if (vi > 0) {
  const vault = process.argv[vi + 1]
  const md = [`---`, `date: ${PLAYBOOK_CHECKED}`, `description: "How each carrier does each policy change (cancel, beneficiary, bank/draft day, address, name): easiest way, form, where it goes, what to have ready. P932."`,
    `tags:`, `  - brain`, `  - ohvara`, `---`, ``, `# Carrier Playbook`, ``,
    `The system takes the path of least resistance (P932, Brayden Nov 9): a change whose carrier takes a signed form goes out as our prefilled **e-sign link** (P886 sends it, a follow-up checks it was processed, the client gets a "done" text); anything else is a **merge call** with the owner. Live copy: \`public.carrier_playbook\` (admin and VAs edit it in the portal; every edit is logged in \`carrier_playbook_log\`). This note is the researched seed from ${PLAYBOOK_CHECKED}; source of truth for the seed: \`src/lib/servicing/playbookData.js\` in ohvara-dashboard.`, ``,
    `Methods: **E-sign** = signed form by fax/email/upload · **Online** = the owner in their own account · **Merge call** = the owner on the phone with the carrier · **Check** = not confirmed, check on first call and save what you learn.`, ``,
    `Related: [[How Ohvara Works]] · [[Jordan Hand-off Pack]] · [[Memories]]`, ``]
  for (const p of PLAYBOOK) {
    const c = CARRIER_CATALOG.find(x => x.id === p.key)
    md.push(`## ${c.name}`, ``, `Service line **${p.phone}** · ${hoursLine(c)}${p.phoneNote ? `. ${p.phoneNote}` : ''} · Source: ${p.source} · Checked ${PLAYBOOK_CHECKED}`, ``,
      `| Change | Easiest way | Form | Send to | Have ready | Notes |`, `|---|---|---|---|---|---|`)
    for (const a of ACTIONS) {
      const s = p.actions[a]
      const form = s.form ? (s.url ? `[${s.form}](${s.url.replace(/ /g, '%20')})` : s.form) : '—'
      const to = s.via ? `${VIA_WORD[s.via]} ${s.to || ''}`.trim() : '—'
      const way = `${METHOD[s.method].label}${s.method === 'esign' && s.esign === 'no' ? ' (wet ink: print, sign, photo)' : ''}`
      md.push(`| ${ACTION_WORD[a]} | ${way} | ${form} | ${to} | ${(s.have || []).join(', ')} | ${(s.notes || '').replace(/\|/g, '/')} |`)
    }
    md.push('')
  }
  writeFileSync(`${vault}/brain/ohvara/Carrier Playbook.md`, md.join('\n'))
  console.log('vault note written')
}
