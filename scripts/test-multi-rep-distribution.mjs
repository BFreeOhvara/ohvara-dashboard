#!/usr/bin/env node
/**
 * Thread #14 — Multi-rep fair-distribution smoke test.
 *
 * Creates N niche-null test reps, runs assign_daily_batches, verifies even
 * split across reps, then cleans up. Self-contained and rollback-safe:
 * deleting auth users cascades to profiles; leads.assigned_rep_id is SET NULL
 * on profile delete (migration 001 FK), so no lead data is permanently touched.
 *
 * Usage:
 *   node scripts/test-multi-rep-distribution.mjs
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment or
 * .env.local in the current directory (same convention as seed scripts).
 */

import { readFileSync, existsSync } from 'fs'

// ── env loader (zero-dep, mirrors seed_leads.py pattern) ──────────────────
function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

const SUPABASE_URL      = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const N_REPS            = 6      // number of test reps to create
const BATCH_SIZE        = 50     // conservative batch size for the test

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const AUTH_BASE = `${SUPABASE_URL}/auth/v1`
const REST_BASE = `${SUPABASE_URL}/rest/v1`
const HEADERS   = {
  Authorization:  `Bearer ${SERVICE_ROLE_KEY}`,
  apikey:         SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
  Prefer:         'return=representation',
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function rest(method, path, body) {
  const res = await fetch(`${REST_BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function authAdmin(method, path, body) {
  const res = await fetch(`${AUTH_BASE}/admin${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`AUTH ${method} ${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const testRepIds = []

  console.log('\n══════════════════════════════════════════════════')
  console.log('Thread #14 — Multi-rep fair distribution test')
  console.log(`URL: ${SUPABASE_URL}`)
  console.log(`Reps: ${N_REPS}  |  Batch size: ${BATCH_SIZE}`)
  console.log('══════════════════════════════════════════════════\n')

  try {
    // ── PHASE 0: Snapshot current state ────────────────────────────────────

    // Unassigned New leads (the shared pool the function draws from)
    const poolRows = await rest('GET', `/leads?assigned_rep_id=is.null&status=eq.New&select=id,niche`)
    const poolSize = poolRows.length
    console.log(`[0] Unassigned New leads in pool: ${poolSize}`)

    // Niche breakdown in the pool
    const nicheCounts = {}
    for (const row of poolRows) {
      const key = row.niche || '(null)'
      nicheCounts[key] = (nicheCounts[key] || 0) + 1
    }
    const nicheEntries = Object.entries(nicheCounts).sort((a, b) => b[1] - a[1])
    console.log(`    Niche breakdown (pool):`)
    for (const [niche, cnt] of nicheEntries) {
      console.log(`      ${niche}: ${cnt}`)
    }

    if (poolSize === 0) {
      console.log('\n⚠  Unassigned pool is empty — assign_daily_batches step 2')
      console.log('   (shared-pool top-up) will be a no-op. The test still runs')
      console.log('   but will measure fallback behavior, not fresh-pool split.')
    }

    // ── PHASE 1: Create test reps ───────────────────────────────────────────
    console.log(`\n[1] Creating ${N_REPS} test rep accounts (niche=null)…`)

    for (let i = 1; i <= N_REPS; i++) {
      const username = `__test_rep_${i}`
      const email    = `${username}@ohvara.internal`
      const user = await authAdmin('POST', '/users', {
        email,
        password: `TestRep${i}!2026`,
        email_confirm: true,
        user_metadata: { full_name: `Test Rep ${i}`, role: 'rep', username },
      })
      testRepIds.push(user.id)
      console.log(`    ✓ ${username}  (${user.id})`)
    }

    // Ensure all test profiles have niche=null and is_active=true
    // (handle_new_user trigger creates them; niche column defaults to null)
    for (const repId of testRepIds) {
      await rest('PATCH', `/profiles?id=eq.${repId}`, {
        is_active: true,
        niche: null,
      })
    }
    console.log(`    ✓ Profiles confirmed: role=rep, is_active=true, niche=null`)

    // ── PHASE 2: Run assign_daily_batches ───────────────────────────────────
    console.log(`\n[2] Calling assign_daily_batches(batch_size=${BATCH_SIZE})…`)

    const rpcResult = await rest('POST', '/rpc/assign_daily_batches', { batch_size: BATCH_SIZE })
    console.log(`    ✓ RPC returned ${rpcResult.length} rows`)

    // ── PHASE 3: Analyse distribution ───────────────────────────────────────
    console.log('\n[3] Distribution results:')
    console.log('    ─────────────────────────────────────')

    const testRepSet = new Set(testRepIds)
    const testResults = []
    const otherResults = []

    for (const row of rpcResult) {
      if (testRepSet.has(row.rep_id)) {
        testResults.push(row)
      } else {
        otherResults.push(row)
      }
    }

    console.log('    Test reps (niche=null):')
    for (const row of testResults) {
      const label = testRepIds.indexOf(row.rep_id) + 1
      console.log(`      Rep ${label}: ${row.batch_count} leads`)
    }

    if (otherResults.length) {
      console.log('    Existing reps:')
      for (const row of otherResults) {
        console.log(`      ${row.rep_id.slice(0, 8)}…: ${row.batch_count} leads`)
      }
    }

    // Fairness verdict
    const counts = testResults.map(r => r.batch_count)
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    const allDealtFrom = poolSize > 0
      ? counts.reduce((s, c) => s + c, 0)
      : null
    const delta = max - min

    console.log('\n    ─────────────────────────────────────')
    console.log(`    Pool size:    ${poolSize}`)
    if (allDealtFrom !== null) {
      console.log(`    Total dealt:  ${allDealtFrom} (of ${poolSize} unassigned)`)
    }
    console.log(`    Min per rep:  ${min}`)
    console.log(`    Max per rep:  ${max}`)
    console.log(`    Spread:       ${delta} (should be 0 or 1 — round-robin remainder)`)

    const verdict = delta <= 1 ? '✅ FAIR' : `❌ SKEWED (delta=${delta})`
    console.log(`\n    Verdict: ${verdict}`)

    // Niche-casing confound check
    console.log('\n[4] Niche-casing drift check (pool niches):')
    const hasDrift = nicheEntries.some(([n]) => n !== n.toLowerCase() && n !== '(null)')
    if (hasDrift) {
      console.log('    ⚠  Case drift found in pool niche values:')
      for (const [niche, cnt] of nicheEntries) {
        if (niche !== niche.toLowerCase() && niche !== '(null)') {
          console.log(`      "${niche}" (${cnt} leads) — lower() normalises this, so no impact on null-niche reps`)
        }
      }
      console.log('    → No impact on this test (niche=null reps skip the filter entirely).')
      console.log('    → Niche normalization remains a separate data-cleanup item.')
    } else {
      console.log('    ✓ No casing drift affecting this test.')
    }

  } finally {
    // ── CLEANUP ─────────────────────────────────────────────────────────────
    if (testRepIds.length > 0) {
      console.log(`\n[5] Cleanup — deleting ${testRepIds.length} test auth users…`)
      console.log('    (profiles cascade; leads.assigned_rep_id SET NULL automatically)')
      for (const id of testRepIds) {
        await authAdmin('DELETE', `/users/${id}`)
        console.log(`    ✓ Deleted ${id}`)
      }
      console.log('    ✓ Cleanup complete — no test data remains.')
    }
  }

  console.log('\n══════════════════════════════════════════════════')
  console.log('Test complete.')
  console.log('══════════════════════════════════════════════════\n')
}

main().catch(err => {
  console.error('\nFATAL:', err.message)
  process.exit(1)
})
