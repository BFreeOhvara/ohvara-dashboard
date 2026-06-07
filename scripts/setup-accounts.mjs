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

const ACCOUNTS = [
  { username: 'brayden11', password: 'Ohvara2026!', full_name: 'Brayden', role: 'admin' },
  { username: 'rep_sarah',  password: 'Sarah2026!',  full_name: 'Sarah',   role: 'rep'   },
]

async function main() {
  console.log('\nOhvara — account setup')
  console.log(`URL: ${SUPABASE_URL}\n`)

  for (const { username, password, full_name, role } of ACCOUNTS) {
    const email = `${username}@ohvara.internal`
    console.log(`── ${username} (${role}) ─────────────────────`)

    const res = await fetch(`${AUTH_BASE}/admin/users`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name, role, username },
      }),
    })

    const text = await res.text()

    if (res.ok) {
      const user = JSON.parse(text)
      console.log(`  ✓ Created  ${user.id}`)
      console.log(`  ✓ Login:   ${username} / ${password}`)
    } else if (res.status === 422 || text.includes('already been registered')) {
      console.log(`  ℹ Already exists — skipped`)
    } else {
      throw new Error(`POST /admin/users → ${res.status}: ${text}`)
    }

    console.log()
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
