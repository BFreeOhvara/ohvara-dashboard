import { useAccount } from '../template/kit'
import { useAuth } from '../hooks/useAuth'

// P1004 — only the owner (Brayden, profiles.is_owner, migration 275) may invite another admin; every other admin gets
// Agent and Fulfillment. send-agent-invite, claim-invite and the rep_invites insert rule refuse it too, so hiding the
// choice is only the polite half. Signed out (the /preview/admin sample) you are the sample owner.
export function useIsOwner() {
  const { live } = useAccount()
  const { profile } = useAuth()
  return live ? profile?.is_owner === true : true
}
export const ROLE_WORD = { agent: 'Agent', fulfillment: 'Fulfillment', admin: 'Admin' }
export const roleOptions = owner => [{ key: 'agent', label: 'Agent' }, { key: 'fulfillment', label: 'Fulfillment' }, ...(owner ? [{ key: 'admin', label: 'Admin' }] : [])]
