// @vitest-environment jsdom
// /agent/submit?kind=deal&lead=<id>: the deal form is prefilled from the agent's own lead, by id. An unknown or
// another agent's id (not in their own list) prefills nothing. The form itself is stubbed; this proves the wiring.
// Run: npx vitest run src/pages/agent/Submit.test.jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const db = vi.hoisted(() => ({ leads: [], fail: false }))
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: () => Promise.resolve(db.fail ? { data: null, error: { code: 'XX000', message: 'down' } } : { data: db.leads, error: null }) },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'agent-1', role: 'agent', has_servicing: true } }) }))
vi.mock('../../hooks/useAppSettings', () => ({ useSubmitLive: () => ({ live: true }) }))
vi.mock('./BookCall', () => ({ default: () => null }))
vi.mock('./ServiceRequest', () => ({ default: () => null }))
vi.mock('./SubmitDeal', () => ({ default: ({ prefill }) => <pre data-testid="form">{JSON.stringify(prefill)}</pre> }))

import Submit from './Submit'

const MINE = { lead_id: 'lead-1', contact_name: 'Denise Walker', phone: '+18135550127', city: 'Tampa', state: 'FL' }

function mount(search) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/agent/submit${search}`]}><Submit /></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => { db.leads = [MINE]; db.fail = false })
afterEach(cleanup)

describe('deal form prefill', () => {
  it('fills the client fields from the lead with that id', async () => {
    mount('?kind=deal&lead=lead-1')
    const form = await screen.findByTestId('form')
    expect(JSON.parse(form.textContent)).toEqual({ first: 'Denise', last: 'Walker', phone: '(813) 555-0127', city: 'Tampa', state: 'FL' })
  })

  it('prefills nothing for an unknown id or another agent\'s lead', async () => {
    mount('?kind=deal&lead=someone-elses-lead')
    expect((await screen.findByTestId('form')).textContent).toBe('null')
  })

  it('prefills nothing without a lead in the link', async () => {
    mount('?kind=deal')
    expect((await screen.findByTestId('form')).textContent).toBe('null')
  })

  it('opens a blank form with a plain note when the leads cannot load', async () => {
    db.fail = true
    mount('?kind=deal&lead=lead-1')
    expect((await screen.findByTestId('form')).textContent).toBe('null')
    expect(screen.getByRole('status').textContent).toMatch(/couldn.t load that lead/)
  })
})
