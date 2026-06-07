#!/usr/bin/env node
/**
 * One-time account setup — creates Ohvara auth accounts via Supabase Admin API.
 * This is the only reliable way to create users with GoTrue-compatible password hashes.
 *
 * Usage:
 *   SUPABASE_URL=https://jjextitmbptoaolacocs.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key> \
 *   node scripts/setup-accounts.mjs
 *
 * Service role key: Supabase Dashboard → Project Settings → API → service_role (secret)
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('\nMissing required environment variables:')
  if (!SUPABASE_URL)        console.error('  SUPABASE_URL')
  if (!SERVICE_ROLE_KEY)    console.error('  SUPABASE_SERVICE_ROLE_KEY')
  console.error('\nRun as:')
  console.error('  SUPABASE_URL=https://jjextitmbptoaolacocs.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/setup-accounts.mjs\n')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ACCOUNTS = [
  { username: 'brayden11', password: 'Ohvara2026!', full_name: 'Brayden', role: 'admin' },
  { username: 'rep_sarah',  password: 'Sarah2026!',  full_name: 'Sarah',   role: 'rep'   },
]

async function deleteIfExists(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(`listUsers failed: ${error.message}`)
  const existing = data.users.find(u => u.email === email)
  if (existing) {
    const { error: delError } = await supabase.auth.admin.deleteUser(existing.id)
    if (delError) throw new Error(`deleteUser failed: ${delError.message}`)
    console.log(`  ✓ Removed existing broken account`)
  }
}

async function createAccount({ username, password, full_name, role }) {
  const email = `${username}@ohvara.internal`
  console.log(`\n── ${username} (${role}) ─────────────────────`)

  await deleteIfExists(email)

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role, username },
  })

  if (error) throw new Error(`createUser failed for ${username}: ${error.message}`)

  console.log(`  ✓ Created  id:       ${data.user.id}`)
  console.log(`  ✓ Email:             ${email}`)
  console.log(`  ✓ Login username:    ${username}`)
  console.log(`  ✓ Password:          ${password}`)
}

async function main() {
  console.log('\nOhvara — account setup')
  console.log('URL:', SUPABASE_URL)

  for (const account of ACCOUNTS) {
    await createAccount(account)
  }

  console.log('\n────────────────────────────────────────────')
  console.log('Done. Test login at your dashboard URL.')
  console.log('  brayden11 / Ohvara2026!  →  admin')
  console.log('  rep_sarah / Sarah2026!   →  rep')
  console.log()
}

main().catch(err => {
  console.error('\nFATAL:', err.message)
  process.exit(1)
})
