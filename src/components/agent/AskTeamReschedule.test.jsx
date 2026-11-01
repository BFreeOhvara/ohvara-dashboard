// @vitest-environment jsdom
// Ask the team to reschedule: the real click path with only the Supabase client mocked. It fails if the
// message goes anywhere but direct_messages, is routed to the wrong line, or the button/err states drift.
// Run: npx vitest run src/components/agent/AskTeamReschedule.test.jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const db = vi.hoisted(() => ({ policy: null, insert: null, from: null }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a) => db.from(...a),
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'agent-1', timezone: 'America/Chicago' } }) }))

import AskTeamReschedule from './AskTeamReschedule'

const TZ = 'America/Chicago'
const NOW = Date.UTC(2026, 10, 1, 20, 0) // Sun Nov 1, 2:00 PM Central
const AT = new Date(Date.UTC(2026, 10, 1, 22, 0)).toISOString() // Sun Nov 1, 4:00 PM Central
const item = (over = {}) => ({
  id: 'a-1', kind: 'a', word: 'Annual review', name: 'Carla Mendez', at: AT, ms: new Date(AT).getTime(), tone: 'up', live: false, change: null,
  policyId: 'pol-1', ...over,
})
const POLICY = { id: 'pol-1', agent_id: 'agent-1', client_first_name: 'Carla', client_last_name: 'Mendez', assigned_fulfillment_id: 'rep-9', fulfillment_assigned: true }

function mount(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AskTeamReschedule item={item()} tz={TZ} nowMs={NOW} {...props} /></MemoryRouter>
    </QueryClientProvider>,
  )
}
const press = () => fireEvent.click(screen.getByRole('button', { name: 'Ask the team to reschedule' }))

beforeEach(() => {
  db.policy = POLICY
  db.insert = vi.fn(() => Promise.resolve({ error: null }))
  db.from = vi.fn(table => {
    if (table === 'policies') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: db.policy, error: null }) }) }) }
    if (table === 'direct_messages') return { insert: row => db.insert(row) }
    throw new Error(`unexpected table ${table}`)
  })
})
afterEach(cleanup)

describe('who sees the button', () => {
  const shown = over => { const { container } = mount({ item: item(over) }); const n = container.querySelectorAll('button').length; cleanup(); return n === 1 }
  it('shows only for a future, live-less, unfinished appointment with a client and no Reschedule', () => {
    expect(shown({})).toBe(true)
    expect(shown({ policyId: null })).toBe(false) // a lead appointment
    expect(shown({ live: true })).toBe(false)
    expect(shown({ tone: 'done' })).toBe(false)
    expect(shown({ ms: NOW - 1 })).toBe(false)
    expect(shown({ change: '/agent/submit?change=pol-1' })).toBe(false) // Reschedule already there
  })
})

describe('a real send', () => {
  it('reads nothing until the first click', () => {
    mount()
    expect(db.from).not.toHaveBeenCalled()
  })

  it('inserts one direct_messages row on the rep line, then shows Sent with a link to Messages', async () => {
    mount()
    press()
    await waitFor(() => expect(db.insert).toHaveBeenCalledTimes(1))
    expect(db.insert).toHaveBeenCalledWith({
      agent_id: 'agent-1', peer_id: 'rep-9', sender_id: 'agent-1',
      body: 'Can we move the annual review with Carla Mendez on Sun, Nov 1, 4:00 PM your time? Please suggest a new time.',
    })
    expect(await screen.findByText(/Sent to the team\. They will reply on your Messages line\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Messages' }).getAttribute('href')).toBe('/messages')
    expect(screen.queryByRole('button', { name: 'Ask the team to reschedule' })).toBeNull()
    expect(db.from.mock.calls.map(c => c[0]).sort()).toEqual(['direct_messages', 'policies'])
  })

  it('sends to Admin (peer_id null) when the client has no rep', async () => {
    db.policy = { ...POLICY, assigned_fulfillment_id: null, fulfillment_assigned: false }
    mount()
    press()
    await waitFor(() => expect(db.insert).toHaveBeenCalledTimes(1))
    expect(db.insert.mock.calls[0][0]).toMatchObject({ agent_id: 'agent-1', peer_id: null, sender_id: 'agent-1' })
  })

  it('shows the error and keeps the button when the insert is rejected, and a second press sends again', async () => {
    db.insert = vi.fn().mockResolvedValueOnce({ error: { message: 'denied' } }).mockResolvedValueOnce({ error: null })
    mount()
    press()
    expect(await screen.findByText("Couldn't send that. Try again.")).toBeTruthy()
    const btn = screen.getByRole('button', { name: 'Ask the team to reschedule' })
    expect(btn.disabled).toBe(false)
    expect(screen.queryByText(/Sent to the team/)).toBeNull()
    fireEvent.click(btn)
    expect(await screen.findByText(/Sent to the team/)).toBeTruthy()
    expect(db.insert).toHaveBeenCalledTimes(2)
  })

  it('shows the error and sends nothing when the policy cannot be read', async () => {
    db.policy = null
    mount()
    press()
    expect(await screen.findByText("Couldn't send that. Try again.")).toBeTruthy()
    expect(db.insert).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Ask the team to reschedule' })).toBeTruthy()
  })
})

describe('sample mode', () => {
  it('shows Sent without reading or writing anything', () => {
    mount({ sample: true })
    press()
    expect(screen.getByText(/Sent to the team/)).toBeTruthy()
    expect(db.from).not.toHaveBeenCalled()
    expect(db.insert).not.toHaveBeenCalled()
  })
})
