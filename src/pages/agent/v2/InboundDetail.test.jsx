// @vitest-environment jsdom
// The lead page's outcome card with supabase.rpc stubbed (migration 210 is not applied): Follow up shows a date
// picker, Not interested needs a reason, Sold shows Submit for servicing only with a Servicing plan, and a missing
// function gives a plain note instead of a crash.
// Run: npx vitest run src/pages/agent/v2/InboundDetail.test.jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const db = vi.hoisted(() => ({ profile: null, leads: [], outcome: null, calls: [] }))
vi.mock('../../../lib/supabase', () => {
  const empty = { select: () => empty, eq: () => empty, or: () => empty, order: () => empty, limit: () => empty, then: (ok) => ok({ data: [], error: null }) }
  return {
    supabase: {
      from: () => empty,
      rpc: (name, args) => {
        db.calls.push([name, args])
        if (name === 'agent_inbounds') return Promise.resolve({ data: db.leads, error: null })
        if (name === 'set_inbound_outcome') return db.outcome(args)
        return Promise.resolve({ data: [], error: null })
      },
    },
  }
})
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ profile: db.profile, session: { user: { id: 'agent-1' } } }) }))

import InboundDetail from './InboundDetail'

const LEAD = {
  lead_id: 'lead-1', lead_type: 'mortgage_protection', inbound_product: 'booked_appointment', inbound_stage: 'booked', outcome: null,
  contact_name: 'Denise Walker', phone: '+18135550127', city: 'Tampa', state: 'FL', created_at: '2026-10-30T15:00:00Z',
  qualifier_answers: {}, follow_up_at: null, outcome_reason: null, follow_up_due: false,
}
const PROFILE = { id: 'agent-1', role: 'agent', timezone: 'America/Chicago', has_servicing: true }

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/agent/inbounds/lead-1']}>
        <Routes><Route path="/agent/inbounds/:id" element={<InboundDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const outcomeCalls = () => db.calls.filter(c => c[0] === 'set_inbound_outcome').map(c => c[1])
const press = name => fireEvent.click(screen.getByRole('button', { name }))
const future = () => {
  const d = new Date(Date.now() + 3 * 864e5)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T14:00`
}

beforeEach(() => {
  db.profile = PROFILE
  db.leads = [LEAD]
  db.calls = []
  db.outcome = () => Promise.resolve({ data: 'sold', error: null })
})
afterEach(cleanup)

describe('outcome card', () => {
  it('Sold saves at once with only the old arguments, then offers Submit for servicing with the id-only link', async () => {
    mount()
    await screen.findByText('How did it go?')
    expect(screen.queryByText(/is now your client/)).toBeNull()
    expect(screen.getByText(/Sold records the outcome\. Submit it for servicing when you are ready\./)).toBeTruthy()
    press('Sold')
    const link = await screen.findByRole('link', { name: 'Submit for servicing' })
    expect(link.getAttribute('href')).toBe('/agent/submit?kind=deal&lead=lead-1')
    expect(screen.getByText('Counts toward this week.')).toBeTruthy()
    expect(outcomeCalls()).toEqual([{ p_lead: 'lead-1', p_outcome: 'sold', p_note: null }])
  })

  it('hides Submit for servicing when the agent has no Servicing plan', async () => {
    db.profile = { ...PROFILE, has_servicing: false }
    mount()
    await screen.findByText('How did it go?')
    press('Sold')
    await screen.findByText(/Marked Sold/)
    expect(screen.queryByRole('link', { name: 'Submit for servicing' })).toBeNull()
  })

  it('Follow up opens a date picker, refuses a past time, and saves p_follow_up_at', async () => {
    mount()
    await screen.findByText('How did it go?')
    press('Follow up')
    const input = screen.getByLabelText('Follow up on')
    expect(input.getAttribute('type')).toBe('datetime-local')
    fireEvent.change(input, { target: { value: '2020-01-01T10:00' } })
    press('Save Follow up')
    expect((await screen.findByRole('alert')).textContent).toMatch(/future/)
    expect(outcomeCalls()).toHaveLength(0)
    fireEvent.change(input, { target: { value: future() } })
    press('Save Follow up')
    await waitFor(() => expect(outcomeCalls()).toHaveLength(1))
    const args = outcomeCalls()[0]
    expect(args.p_outcome).toBe('follow_up')
    expect(new Date(args.p_follow_up_at).getTime()).toBeGreaterThan(Date.now())
    expect(args).not.toHaveProperty('p_reason')
    await screen.findByText(/^✓ Follow up \w{3} \d{1,2} at 2:00 PM$/)
  })

  it('Not interested needs a reason, then saves p_reason and shows it', async () => {
    mount()
    await screen.findByText('How did it go?')
    press('Not interested')
    press('Save Not interested')
    expect((await screen.findByRole('alert')).textContent).toMatch(/Say why/)
    expect(outcomeCalls()).toHaveLength(0)
    const box = screen.getByLabelText('Why are they not interested?')
    expect(box.getAttribute('maxlength')).toBe('500')
    fireEvent.change(box, { target: { value: 'Already covered' } })
    press('Save Not interested')
    await waitFor(() => expect(outcomeCalls()).toEqual([{ p_lead: 'lead-1', p_outcome: 'not_interested', p_note: null, p_reason: 'Already covered' }]))
    await screen.findByText(/Not interested: Already covered/)
  })

  it('a missing function gives a plain note and the page keeps rendering', async () => {
    db.outcome = () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    mount()
    await screen.findByText('How did it go?')
    press('Follow up')
    fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: future() } })
    press('Save Follow up')
    expect((await screen.findByRole('status')).textContent).toMatch(/isn.t ready yet\. Nothing changed/)
    expect(screen.getByText('Timeline')).toBeTruthy()
    expect(screen.getByText('Texting coming soon')).toBeTruthy()
  })

  it('a due follow up shows the chip on the page', async () => {
    db.leads = [{ ...LEAD, inbound_stage: 'follow_up', outcome: 'follow_up', follow_up_at: '2026-10-31T20:00:00Z', follow_up_due: true }]
    mount()
    await screen.findByText('Follow up due')
  })
})
