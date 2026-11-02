// @vitest-environment jsdom
// The Leads page with supabase stubbed: the duty switch sits on the page (same hook as Today and Settings),
// a missing agent_duty table says Coming soon instead of breaking, and a lead whose follow up is due shows the chip.
// Run: npx vitest run src/pages/agent/v2/Inbounds.test.jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const db = vi.hoisted(() => ({ leads: [], duty: null, dutyError: null, upserts: [] }))
vi.mock('../../../lib/supabase', () => {
  const chain = (result) => {
    const c = { select: () => c, eq: () => c, or: () => c, order: () => c, limit: () => c, maybeSingle: () => Promise.resolve(result()), then: ok => ok(result()) }
    return c
  }
  return {
    supabase: {
      from: table => {
        if (table === 'agent_duty') {
          return { ...chain(() => ({ data: db.duty, error: db.dutyError })), upsert: row => { db.upserts.push(row); return Promise.resolve({ error: null }) } }
        }
        return chain(() => ({ data: [], error: null }))
      },
      rpc: name => Promise.resolve(name === 'agent_inbounds' ? { data: db.leads, error: null } : { data: [], error: null }),
    },
  }
})
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'agent-1', role: 'agent', timezone: 'America/Chicago' }, session: { user: { id: 'agent-1' } } }),
}))
vi.mock('../../../components/agent/GetInboundsSlot', () => ({ default: () => null }))

import Inbounds from './Inbounds'

const LEAD = {
  lead_id: 'lead-1', inbound_product: 'booked_appointment', inbound_stage: 'follow_up', outcome: 'follow_up', contact_name: 'Denise Walker',
  phone: '+18135550127', state: 'FL', created_at: '2026-10-30T15:00:00Z', follow_up_at: '2026-10-31T20:00:00Z', follow_up_due: true,
}

function mount(path = '/agent/leads') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><Inbounds /></MemoryRouter></QueryClientProvider>,
  )
}

beforeEach(() => { db.leads = [LEAD]; db.duty = { on_duty: false, since: null }; db.dutyError = null; db.upserts = [] })
afterEach(cleanup)

describe('Leads page', () => {
  it('has the duty switch and flipping it writes the agent\'s own row', async () => {
    mount()
    const sw = await screen.findByRole('switch', { name: 'Active for live call transfers' })
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'))
    await screen.findByText(/Not active\./)
    fireEvent.click(sw)
    await waitFor(() => expect(db.upserts).toEqual([{ agent_id: 'agent-1', on_duty: true }]))
  })

  it('says Coming soon, with the switch off, while agent_duty is not in the database', async () => {
    db.dutyError = { code: 'PGRST205', message: 'not found' }
    mount()
    await screen.findByText(/Coming soon\./)
    const sw = screen.getByRole('switch')
    expect(sw.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Booked appointments')).toBeTruthy() // the page still renders
  })

  it('shows Follow up due on a lead whose follow up has come due', async () => {
    mount()
    await screen.findByText('Follow up due')
  })
})
