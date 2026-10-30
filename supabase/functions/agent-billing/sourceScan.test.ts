/**
 * Group 9: a scan of the source. Brayden's rules: no tiers, no plan cards, no Meta / Google /
 * Facebook wording, no per-call / per-appointment / per-booking pricing in what an agent reads
 * about billing or inbound.
 *
 * This reads files, so it needs --allow-read. Without it the scan tests show as "ignored"
 * (never as passed). Full run:
 *   deno test --allow-env --allow-read --node-modules-dir=none supabase/functions/agent-billing/
 */

const root = new URL('../../../', import.meta.url)
const canRead = (await Deno.permissions.query({ name: 'read' })).state === 'granted'
if (!canRead) console.warn('sourceScan.test.ts: no --allow-read, so the group 9 source scan is IGNORED, not passed.')

// Old tier UI that is still in src/ and is not part of this task. Each entry is exactly the
// pattern that file is known to hit. Delete the entry when the file is cleaned; a stale
// entry fails the "allowlist is current" test so it cannot hide a new violation.
const KNOWN_LEGACY: Record<string, string[]> = {
  'src/components/agent/AgentUI.jsx': ['PlanCard', 'agent_billing_tiers'], // the tier card and a comment naming its table
  'src/components/agent/BillingPanel.jsx': ['PlanCard', 'agent_billing_tiers'],
  'src/components/agent/TodayCards.jsx': ['PlanCard'], // a local usage card that only shares the name
  'src/hooks/useBillingTiers.js': ['agent_billing_tiers'],
}

const CODE_RULES: [string, RegExp][] = [
  ['PlanCard', /\bPlanCard\b/],
  ['agent_billing_tiers', /agent_billing_tiers/],
  ['(Standard|Premium) plan', /\b(Standard|Premium) plan\b/i],
]

// Brand names (whole word, as written) and per-unit pricing phrases. "Google Pay" is a card wallet.
const WORDING_RULES: [string, RegExp][] = [
  ['Meta', /\bMeta\b/], ['Google', /\bGoogle\b(?! Pay)/], ['Facebook', /\bFacebook\b/],
  ['per call', /\bper call\b/i], ['per appointment', /\bper appointment\b/i], ['per booking', /\bper booking\b/i],
]

const EXT = /\.(js|jsx|ts|tsx)$/
const isTest = (p: string) => /\.test\./.test(p)

async function walk(dir: URL, out: string[] = []): Promise<string[]> {
  for await (const e of Deno.readDir(dir)) {
    const url = new URL(e.name + (e.isDirectory ? '/' : ''), dir)
    if (e.isDirectory) { if (e.name !== 'node_modules') await walk(url, out) }
    else if (EXT.test(e.name) && !isTest(e.name)) out.push(url.href.slice(root.href.length))
  }
  return out
}

const read = (path: string) => Deno.readTextFile(new URL(path, root))

// Comments may talk about the rules; only code and strings an agent could see are checked for wording.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\w])\/\/.*$/gm, '$1')

async function sourceFiles() {
  return [...await walk(new URL('src/', root)), ...await walk(new URL('supabase/functions/agent-billing/', root))]
}

// What an agent reads about billing or inbound: anything with billing or inbound in its path, plus the function.
const billingOrInbound = (p: string) => /billing|inbound/i.test(p.split('/').pop()!) || p.startsWith('supabase/functions/agent-billing/')

Deno.test({ name: 'scan: the file walk finds the billing and inbound files', ignore: !canRead, fn: async () => {
  const files = await sourceFiles()
  for (const must of ['src/lib/billing.js', 'src/lib/billingInbound.js', 'supabase/functions/agent-billing/core.ts']) {
    if (!files.includes(must)) throw new Error(`scan did not reach ${must}`)
  }
  if (files.filter(billingOrInbound).length < 8) throw new Error('scan found suspiciously few billing/inbound files')
} })

Deno.test({ name: 'scan: no PlanCard, agent_billing_tiers or "(Standard|Premium) plan" outside the known legacy files', ignore: !canRead, fn: async () => {
  const hits: string[] = []
  for (const path of await sourceFiles()) {
    const src = await read(path)
    for (const [name, re] of CODE_RULES) {
      if (re.test(src) && !KNOWN_LEGACY[path]?.includes(name)) hits.push(`${path}: ${name}`)
    }
  }
  if (hits.length) throw new Error(`Banned plan/tier code found:\n  ${hits.join('\n  ')}`)
} })

Deno.test({ name: 'scan: the known-legacy allowlist is current (no stale entries)', ignore: !canRead, fn: async () => {
  const stale: string[] = []
  for (const [path, names] of Object.entries(KNOWN_LEGACY)) {
    const src = await read(path).catch(() => '')
    for (const name of names) {
      const re = CODE_RULES.find(([n]) => n === name)![1]
      if (!re.test(src)) stale.push(`${path} no longer contains ${name}: remove it from KNOWN_LEGACY`)
    }
  }
  if (stale.length) throw new Error(stale.join('\n'))
} })

Deno.test({ name: 'scan: no Meta / Google / Facebook / per call / per appointment / per booking in billing or inbound code', ignore: !canRead, fn: async () => {
  const hits: string[] = []
  for (const path of (await sourceFiles()).filter(billingOrInbound)) {
    const lines = stripComments(await read(path)).split('\n')
    lines.forEach((line, i) => {
      for (const [name, re] of WORDING_RULES) if (re.test(line)) hits.push(`${path}:${i + 1} "${name}": ${line.trim().slice(0, 100)}`)
    })
  }
  if (hits.length) throw new Error(`Banned wording found:\n  ${hits.join('\n  ')}`)
} })

Deno.test({ name: 'scan: the wording rules would catch a planted violation', fn: () => {
  const planted = ['Run Meta ads', 'Google leads', 'from Facebook', '$55 per call', 'per Appointment', 'per booking']
  for (const text of planted) {
    if (!WORDING_RULES.some(([, re]) => re.test(text))) throw new Error(`rule missed: ${text}`)
  }
  for (const ok of ['Pay with Google Pay', 'metadata', 'a call each week', 'Policy Servicing']) {
    if (WORDING_RULES.some(([, re]) => re.test(ok))) throw new Error(`rule false positive: ${ok}`)
  }
  if (!CODE_RULES.every(([, re]) => re.test('PlanCard agent_billing_tiers Standard plan'))) throw new Error('code rule missed')
} })
