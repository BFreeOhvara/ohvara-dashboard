// Wording guard: agents see "lead" and "leads", never "inbound" (code names, routes and columns keep it).
// `npm run check:wording` runs it alone; `npm test` runs it first (scripts/run-tests.mjs). It is NOT part
// of prebuild, so a wording hit never blocks a Vercel deploy.
//
// Parses every src/**/*.{js,jsx} (tests, comments and imports are skipped) and prints file:line for:
//   - JSX text containing inbound(s) in any case
//   - a string or template literal with a capitalized "Inbound"
//   - a string or template literal where the word sits next to other words ('New inbound', 'From inbounds')
//   - any value of a label / title / placeholder / aria-label / text / sub / what prop containing it
// Allowed: code-like lowercase tokens with no spaces ('inbound', 'inbounds', 'inbound_product',
// 'inbound-events') and route paths (/agent/inbounds/...). Exit 1 on a hit, 0 otherwise.
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

let espree
try {
  espree = await import('espree') // comes with eslint (devDependency)
} catch {
  console.error('check-wording: cannot load espree (run npm install first)')
  process.exit(1)
}

const WORD = /inbound/i
const PROPS = new Set(['label', 'title', 'placeholder', 'aria-label', 'text', 'sub', 'what'])
const CODE_TOKEN = /^[a-z0-9_.:/\-]+$/
const ROUTE = /^\/agent\/inbounds(\/|$)/

// Billing helper no rendered page imports yet; a Deno test under supabase/ pins its exact text, so it stays as on master.
const NOT_RENDERED = new Set(['src/lib/billingInbound.js'])

const files = globSync('src/**/*.{js,jsx}')
  .map(f => f.replaceAll('\\', '/'))
  .filter(f => !/\.test\.jsx?$/.test(f))
  .filter(f => !NOT_RENDERED.has(f))
  .sort()

const hits = []
const hit = (file, node, why) => hits.push(`${file}:${node.loc.start.line}  ${why}`)
const snip = s => JSON.stringify(s.replace(/\s+/g, ' ').trim().slice(0, 70))

// Why a string value is not allowed, or null when it is a code token or a route.
function badString(value) {
  if (!WORD.test(value)) return null
  if (ROUTE.test(value)) return null
  if (/Inbound/.test(value)) return 'capitalized Inbound in text'
  if (!CODE_TOKEN.test(value)) return 'inbound next to other words'
  return null
}

const stringsOf = node => {
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value]
  if (node.type === 'TemplateLiteral') return node.quasis.map(q => q.value.cooked ?? q.value.raw)
  return []
}

function checkNode(file, node, parent) {
  if (node.type === 'JSXText' && WORD.test(node.value)) hit(file, node, `JSX text ${snip(node.value)}`)

  const skipSource = parent && ['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(parent.type)
  if (!skipSource) {
    for (const s of stringsOf(node)) {
      const why = badString(s)
      if (why) hit(file, node, `${why} ${snip(s)}`)
    }
  }

  // label-like props: any mention counts, even a lone lowercase "inbound"
  let name = null
  let value = null
  if (node.type === 'JSXAttribute' && node.name?.type === 'JSXIdentifier') {
    name = node.name.name
    value = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value
  } else if (node.type === 'JSXAttribute' && node.name?.type === 'JSXNamespacedName') {
    name = `${node.name.namespace.name}:${node.name.name.name}`
  } else if (node.type === 'Property' && !node.computed) {
    name = node.key.type === 'Identifier' ? node.key.name : String(node.key.value)
    value = node.value
  }
  if (name && PROPS.has(name) && value) {
    const texts = stringsOf(value)
    if (value.type === 'ConditionalExpression') {
      for (const side of [value.consequent, value.alternate]) texts.push(...stringsOf(side))
    }
    for (const s of texts) if (WORD.test(s)) hit(file, value, `${name} prop ${snip(s)}`)
  }
}

function walk(file, node, parent) {
  checkNode(file, node, parent)
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue
    if (Array.isArray(child)) child.forEach(c => c && typeof c.type === 'string' && walk(file, c, node))
    else if (child && typeof child.type === 'string') walk(file, child, node)
  }
}

for (const file of files) {
  let ast
  try {
    ast = espree.parse(readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', loc: true, ecmaFeatures: { jsx: true } })
  } catch (e) {
    console.error(`check-wording: cannot parse ${file}: ${e.message}`)
    process.exit(1)
  }
  walk(file, ast, null)
}

if (hits.length) {
  console.error('Wording check failed: agents see "lead"/"leads", never "inbound". Reword these (code names, routes and columns stay):')
  for (const h of [...new Set(hits)]) console.error('  ' + h)
  process.exit(1)
}
console.log(`Wording check passed (${files.length} files).`)
