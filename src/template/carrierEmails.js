// P1027 — Connect carrier emails, the sample side (same shape as hooks/carrierEmailsReal.js REAL_CARRIER_EMAILS).
// The agent's own forwarding address, the carriers whose notices they forward (name + email domain), Gmail's
// forwarding code once Gmail sends it, the Test check and the last few notices.
import { useCallback, useState } from 'react'

const SAMPLE_DATA = {
  address: 'dana-7k2f@notices.ohvara.com',
  carriers: [{ name: 'Ethos', domain: 'ethos-agents.com' }, { name: 'Americo', domain: null }],
  suggested: [{ name: 'Americo', domain: null }, { name: 'Ethos', domain: 'ethos-agents.com' }, { name: 'Transamerica', domain: 'transamerica.com' }],
  all: [{ name: 'Corebridge', domain: 'corebridgefinancial.com' }, { name: 'Ethos', domain: 'ethos-agents.com' }, { name: 'Mutual of Omaha', domain: 'mutualofomaha.com' }, { name: 'Transamerica', domain: 'transamerica.com' }, { name: 'Americo', domain: null }],
  gmail: null,
  test_started_at: null,
  test_ok: false,
  last_email_at: null,
  recent: [
    { id: 'pe-1', at: '2026-11-16T15:38:00Z', subject: 'Premium payment unsuccessful', status: 'matched', category: 'pending_lapse', client: 'Ann L.' },
    { id: 'pe-2', at: '2026-11-12T14:02:00Z', subject: 'You have a new message', status: 'unmatched', category: 'login', client: null },
    { id: 'pe-3', at: '2026-11-09T16:20:00Z', subject: 'Thank you for your payment', status: 'paid_notice', category: 'paid', client: 'Luis O.' },
  ],
}

export const SAMPLE_CARRIER_EMAILS = {
  source: 'sample',
  useCarrierEmails() {
    const [d, setD] = useState(SAMPLE_DATA)
    const saveCarriers = useCallback(async list => { setD(x => ({ ...x, carriers: list })); return list }, [])
    // The sample "arrives" a moment after Test, with Gmail's code, so every state can be seen.
    const startTest = useCallback(async () => {
      setD(x => ({ ...x, test_started_at: new Date().toISOString(), test_ok: false }))
      setTimeout(() => setD(x => ({ ...x, test_ok: true, last_email_at: new Date().toISOString(),
        gmail: { code: '812345678', at: new Date().toISOString(), for: 'dana@gmail.com' } })), 1600)
    }, [])
    const rotate = useCallback(async () => {
      const a = `dana-${Math.random().toString(36).slice(2, 6).padEnd(4, 'x')}@notices.ohvara.com`
      setD(x => ({ ...x, address: a, gmail: null, test_ok: false, test_started_at: null }))
      return a
    }, [])
    return { data: d, loading: false, unavailable: false, refresh: async () => {}, saveCarriers, startTest, rotate }
  },
}
