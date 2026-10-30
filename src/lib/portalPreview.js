import { TEST_ACCOUNT_IDS } from './testAccounts.js'

// Portal preview list: the one gate in front of the v2 agent portal.
// app_settings.agent_portal_v2 on: v2 for everyone, exactly as before. Off: v2 only for the auth user ids
// below, who can step back to the old pages with the "Back to old pages" link (choice kept in localStorage).
// Everyone else gets the old pages whatever is in localStorage or the URL. Display gate only.
//
// IDS ONLY: this file ships to every visitor's browser, so no emails, names or usernames here.
// testagent11 is the test agent already in TEST_ACCOUNT_IDS (src/lib/testAccounts.js).
const [TEST_AGENT_ID] = TEST_ACCOUNT_IDS
// brayden11 (admin). The /agent routes are agent-only, so this id shows v2 only once that login can open them.
const BRAYDEN_ID = '5164aa43-e803-41c5-b96f-1663a53c7404'
// TEST FULFILLMENT ID: testfulfill11's auth user id goes here (not known yet). No fulfillment page reads the gate.
const TEST_FULFILLMENT_ID = null

export const PREVIEW_USER_IDS = new Set([TEST_AGENT_ID, BRAYDEN_ID, TEST_FULFILLMENT_ID].filter(Boolean))

export const isPreviewUser = user => !!user?.id && PREVIEW_USER_IDS.has(user.id)

// The flag itself. Missing column, failed query or still loading all read as off.
export const portalFlagOn = settings => settings?.agent_portal_v2 === true

export const PREVIEW_KEY = 'ov_portal_preview'

export function readPreviewChoice() {
  try {
    const v = localStorage.getItem(PREVIEW_KEY)
    return v === 'v1' || v === 'v2' ? v : null
  } catch { return null }
}

export function writePreviewChoice(choice) {
  try { localStorage.setItem(PREVIEW_KEY, choice === 'v1' ? 'v1' : 'v2') } catch { /* private mode: this visit only */ }
}

// Pure: is the v2 portal on for this user? Preview users default to v2.
export function useV2({ flagOn, user, choice }) {
  if (flagOn) return true
  return isPreviewUser(user) && choice !== 'v1'
}

// The matching page on the other side. v2-only pages without an old twin land on /agent.
const OLD_FOR_V2 = { '/agent/clients': '/agent/clients', '/agent/plan': '/agent/billing' }
const V2_FOR_OLD = { '/agent/clients': '/agent/clients', '/agent/billing': '/agent/plan' }
export const oldPageFor = pathname => OLD_FOR_V2[pathname] || '/agent'
export const v2PageFor = pathname => V2_FOR_OLD[pathname] || '/agent'

// The preview link on an agent page, or null (not on the list, not an agent page, or flag on).
export function previewLink({ flagOn, user, role, pathname, onV2 }) {
  if (flagOn || role !== 'agent' || !isPreviewUser(user) || !pathname?.startsWith('/agent')) return null
  return onV2
    ? { label: 'Back to old pages', choice: 'v1', to: oldPageFor(pathname) }
    : { label: 'Preview v2', choice: 'v2', to: v2PageFor(pathname) }
}
