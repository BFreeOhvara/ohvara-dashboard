// P951: start a Codemagic build from the terminal.
//   node scripts/app/build.mjs ios                 iPhone -> TestFlight (default)
//   node scripts/app/build.mjs ios --submit        iPhone -> TestFlight + App Review (needs Brayden's yes)
//   node scripts/app/build.mjs android             Android -> Play closed testing (draft)
//   node scripts/app/build.mjs android --internal  Android -> Play internal testing (draft)
// Options: --branch <name> (default master), --workflow <id>, --wait (poll until it ends),
//          --status <buildId> (just show a build's status).
// The token: CODEMAGIC_API_TOKEN in .env.local (Codemagic > Account settings > Integrations >
// Codemagic API > Show). Never in chat, never in git. Codemagic builds the branch as pushed
// to GitHub, so push (or merge) the branch first.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const API = 'https://api.codemagic.io'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const WORKFLOWS = {
  ios: 'ios-testflight',
  'ios-submit': 'ios-submit',
  android: 'android-closed',
  'android-internal': 'android-internal',
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

export function parseArgs(argv) {
  const out = { platform: null, flags: new Set(), opts: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--branch' || a === '--workflow' || a === '--status') out.opts[a.slice(2)] = argv[++i]
    else if (a.startsWith('--')) out.flags.add(a.slice(2))
    else if (!out.platform) out.platform = a
  }
  return out
}

export function pickWorkflow({ platform, flags, opts }) {
  if (opts.workflow) return opts.workflow
  if (platform === 'ios') return flags.has('submit') ? WORKFLOWS['ios-submit'] : WORKFLOWS.ios
  if (platform === 'android') {
    if (flags.has('submit')) fail('--submit is for iPhone only. Android goes to Play as a draft; press Start rollout in Play Console.')
    return flags.has('internal') ? WORKFLOWS['android-internal'] : WORKFLOWS.android
  }
  return null
}

function loadToken() {
  // The token can sit in this checkout's .env.local, or the main checkout's (worktrees don't have one).
  const candidates = [path.join(root, '.env.local'), path.resolve(root, '..', 'ohvara-dashboard', '.env.local')]
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      const v = dotenv.parse(fs.readFileSync(f))
      if (v.CODEMAGIC_API_TOKEN) return v.CODEMAGIC_API_TOKEN.trim()
    }
  }
  return (process.env.CODEMAGIC_API_TOKEN || '').trim()
}

async function api(token, method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not json */
  }
  if (res.status === 401 || res.status === 403) {
    fail('Codemagic refused the token (HTTP ' + res.status + '). Make a new one: Codemagic > Account settings > Integrations > Codemagic API > Show, and put it in .env.local as CODEMAGIC_API_TOKEN.')
  }
  if (!res.ok) fail('Codemagic said HTTP ' + res.status + ' for ' + method + ' ' + route + ': ' + (json?.message || text.slice(0, 300)))
  return json
}

async function findApp(token) {
  const data = await api(token, 'GET', '/apps')
  const apps = data?.applications || []
  const hit =
    apps.find((a) => /ohvara-dashboard/i.test(a.appName || a.repositoryName || a.name || '')) ||
    (apps.length === 1 ? apps[0] : null)
  if (!hit) fail('Could not find the ohvara-dashboard app in Codemagic. Apps seen: ' + (apps.map((a) => a.appName || a.name).join(', ') || 'none'))
  return hit._id
}

const link = (appId, buildId) => `https://codemagic.io/app/${appId}/build/${buildId}`

async function showStatus(token, appId, buildId) {
  const data = await api(token, 'GET', '/builds/' + buildId)
  const b = data?.build || data
  console.log(`${b.status}${b.workflowId ? ' (' + b.workflowId + ')' : ''}  ${link(b.appId || appId, buildId)}`)
  return b.status
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = loadToken()
  if (!token) {
    fail(
      'CODEMAGIC_API_TOKEN is missing.\n' +
        'Get it: Codemagic > Account settings (your avatar) > Integrations > Codemagic API > Show.\n' +
        'Save it yourself in ' + path.join(root, '.env.local') + ' as a line: CODEMAGIC_API_TOKEN=...  (the file is gitignored; do not paste it in chat).',
    )
  }
  if (args.opts.status) {
    const appId = await findApp(token)
    await showStatus(token, appId, args.opts.status)
    return
  }
  const workflowId = pickWorkflow(args)
  if (!workflowId) fail('Usage: node scripts/app/build.mjs ios|android [--submit] [--internal] [--branch name] [--wait]\n       node scripts/app/build.mjs --status <buildId>')
  const branch = args.opts.branch || 'master'
  const appId = await findApp(token)
  const { buildId } = await api(token, 'POST', '/builds', { appId, workflowId, branch })
  console.log(`Started ${workflowId} on ${branch}: ${link(appId, buildId)}`)
  if (workflowId === 'ios-submit') console.log('This build will be sent to App Review when it finishes uploading. Release stays manual.')
  if (!args.flags.has('wait')) {
    console.log('Check on it: node scripts/app/build.mjs --status ' + buildId)
    return
  }
  const done = new Set(['finished', 'failed', 'canceled', 'cancelled', 'timeout', 'skipped'])
  for (;;) {
    await new Promise((r) => setTimeout(r, 30000))
    const s = await showStatus(token, appId, buildId)
    if (done.has(s)) process.exit(s === 'finished' ? 0 : 1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
