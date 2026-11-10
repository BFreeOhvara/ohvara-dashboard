// Seed/test accounts that must never bleed into real, company-wide
// reporting (Prompt 371) — Brayden keeps testagent11 (nate44) around
// indefinitely to safely test future changes, but its fabricated policies/
// hierarchy position can't count toward real leaderboard, team, or
// admin-aggregate numbers once the real team (Nate, Jordan, Rego) is live.
//
// P929: the test accounts are a sandbox. profiles.is_test (migrations 260_test_accounts + 261_test_policies_side) is the source of truth;
// these ids are the fallback until that column is there. Test agent (nate44), test VA (tesfulfill11) and the
// App Review demo agent and VA.
export const TEST_ACCOUNT_IDS = new Set([
  '3f2b2df7-40b1-4921-80e2-09981c819642', // Test Agent
  '402a7a07-c9b0-428f-9b9d-ff2b6480bed0', // Test Fulfill (the test VA)
  'c76e4ab2-256d-422c-87dc-0f27ce882981', // Avery Demo (App Review agent)
  'aa149f56-3f13-4ee9-9fd1-e3bcc6082b7d', // Riley Demo (App Review VA)
])

export function isTestAccount(id) {
  return TEST_ACCOUNT_IDS.has(id)
}

// A profile row (or anything with id / is_test) is a test account.
export function isTestProfile(p) {
  return !!p && (p.is_test === true || TEST_ACCOUNT_IDS.has(p.id))
}

// Drops rows belonging to test accounts out of a company-wide rollup, unless
// the viewer IS that test account — so nate44's own dashboard is unaffected
// when it looks at itself.
export function excludeTestAccounts(rows, viewerId, idKey = 'agent_id') {
  return rows.filter(r => r[idKey] === viewerId || !TEST_ACCOUNT_IDS.has(r[idKey]))
}
