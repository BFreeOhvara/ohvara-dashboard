// Seed/test accounts that must never bleed into real, company-wide
// reporting (Prompt 371) — Brayden keeps testagent11 (nate44) around
// indefinitely to safely test future changes, but its fabricated policies/
// hierarchy position can't count toward real leaderboard, team, or
// admin-aggregate numbers once the real team (Nate, Jordan, Rego) is live.
export const TEST_ACCOUNT_IDS = new Set(['3f2b2df7-40b1-4921-80e2-09981c819642'])

export function isTestAccount(id) {
  return TEST_ACCOUNT_IDS.has(id)
}

// Drops rows belonging to test accounts out of a company-wide rollup, unless
// the viewer IS that test account — so nate44's own dashboard is unaffected
// when it looks at itself.
export function excludeTestAccounts(rows, viewerId, idKey = 'agent_id') {
  return rows.filter(r => r[idKey] === viewerId || !TEST_ACCOUNT_IDS.has(r[idKey]))
}
