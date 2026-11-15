// Test accounts (P929): Test Agent (testagent11), Test Fulfill (testfulfill11) and the App Review agent and VA.
// profiles.is_test is the only source of truth. P1013: the database keeps them out of everyone else's directory,
// Messages, lists and numbers (migration 276_hidden_accounts), so the app no longer filters them itself; this only
// answers "is the signed-in user a test account?" (test accounts always see sample info).
export function isTestProfile(p) {
  return !!p && p.is_test === true
}
