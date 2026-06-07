#!/usr/bin/env node
/**
 * One-time account setup — uses fetch() + Supabase REST API directly.
 * No Supabase JS client (avoids Windows libuv async handle crash).
 * Requires Node.js 18+ for native fetch.
 *
 * Usage:
 *   SUPABASE_URL=https://jjextitmbptoaolacocs.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
 *   node scripts/setup-accounts.mjs
 *
 * Service role key: Supabase Dashboard → Project Settings → API → service_role (secret)
 */

const SUPABASE_URL     = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('\nMissing required environment variables:')
  if (!SUPABASE_URL)        console.error('  SUPABASE_URL')
  if (!SERVICE_ROLE_KEY)    console.error('  SUPABASE_SERVICE_ROLE_KEY')
  console.error('\nExample:')
  console.error('  SUPABASE_URL=https://jjextitmbptoaolacocs.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/setup-accounts.mjs\n')
  process.exit(1)
}

const AUTH_BASE = `${SUPABASE_URL}/auth/v1`
const HEADERS   = {
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'apikey':        SERVICE_ROLE_KEY,
  'Content-Type':  'application/json',
}

async function api(method, path, body) {
  const res = await fetch(`${AUTH_BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function findByEmail(email) {
  // GoTrue paginates at 50 by default — fetch enough to cover any small project
  const data = await api('GET', '/admin/users?per_page=1000&page=1')
  const users = data?.users ?? []
  return users.find(u => u.email === email) ?? null
}

async function deleteIfExists(email) {
  const user = await findByEmail(email)
  if (user) {
    await api('DELETE', `/admin/users/${user.id}`)
    console.log(`  ✓ Deleted existing account (${user.id})`)
  }
}

async function createUser({ username, password, full_name, role }) {
  const email = `${username}@ohvara.internal`
  const user = await api('POST', '/admin/users', {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role, username },
  })
  return user
}

const ACCOUNTS = [
  { username: 'brayden11', password: 'Ohvara2026!', full_name: 'Brayden', role: 'admin' },
  { username: 'rep_sarah',  password: 'Sarah2026!',  full_name: 'Sarah',   role: 'rep'   },
]

async function main() {
  console.log('\nOhvara — account setup')
  console.log(`URL: ${SUPABASE_URL}\n`)

  for (const account of ACCOUNTS) {
    const email = `${account.username}@ohvara.internal`
    console.log(`── ${account.username} (${account.role}) ─────────────────────`)

    await deleteIfExists(email)

    const result = await createUser(account)
    console.log(`  ✓ Created  ${result.id}`)
    console.log(`  ✓ Email:   ${email}`)
    console.log(`  ✓ Login:   ${account.username} / ${account.password}\n`)
  }

  console.log('────────────────────────────────────────────')
  console.log('Done.')
  console.log('  brayden11 / Ohvara2026!  →  admin')
  console.log('  rep_sarah / Sarah2026!   →  rep\n')
}

main().catch(err => {
  console.error('\nFATAL:', err.message)
  process.exit(1)
})
