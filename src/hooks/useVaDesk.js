import { useCallback, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAgentBookings, useBookCall } from './useAgentBookings'
import { useCarriers } from './useCarriers'
import { stageOf } from '../lib/agentBookings'
import { leadsSample } from '../lib/leadsPage'
import { openBookingIsos } from '../lib/scheduling'
import { splitName, startingChecklist } from '../lib/vaQueue'

// VA desk (/fulfillment/leads). Every read and write goes through the
// migration-175 functions (va_queue, va_agent_roster, va_claim, va_release,
// va_set_lead_outcome); nothing writes `leads` directly.
//
// A booking is the same policies row Book a call writes (useBookCall, for the
// agent the VA picked) and then va_set_lead_outcome('booked') ties it to the
// lead. A transfer is only a record. Nothing here texts, emails or calls
// anyone: there is no send path in this file.
//
// ?sample=1 (dev only) reads and changes src/lib/vaSample.js in memory instead,
// so screenshots can open the held-lead view without a real lead.

const KEY = ['va-desk']
const mode = () => (import.meta.env.DEV && leadsSample() ? 'sample' : 'live')

// The queue: new, not reached and callbacks that are due. Polled so another
// VA's claim or a new lead shows without a refresh.
export function useVaQueue() {
  return useQuery({
    queryKey: [...KEY, 'queue', mode()],
    refetchInterval: 30e3,
    queryFn: async () => {
      if (import.meta.env.DEV && leadsSample()) {
        const { sampleQueue } = await import('../lib/vaSample')
        return sampleQueue()
      }
      const { data, error } = await supabase.rpc('va_queue')
      if (error) throw error
      return data || []
    },
  })
}

// Active agents a VA can pick (id + name). A plain list: the on-duty toggle
// isn't built yet.
export function useVaRoster() {
  return useQuery({
    queryKey: [...KEY, 'roster', mode()],
    staleTime: 60e3,
    queryFn: async () => {
      if (import.meta.env.DEV && leadsSample()) {
        const { sampleRoster } = await import('../lib/vaSample')
        return sampleRoster()
      }
      const { data, error } = await supabase.rpc('va_agent_roster')
      if (error) throw error
      return data || []
    },
  })
}

// The carrier directory for the checklist and the booking times.
export function useVaCarriers() {
  let sample = {}
  if (import.meta.env.DEV && leadsSample()) {
    sample = {
      queryKey: [...KEY, 'carriers', 'sample'],
      queryFn: async () => {
        const { sampleCarriers } = await import('../lib/vaSample')
        return sampleCarriers()
      },
    }
  }
  return useCarriers(sample)
}

// The times an agent already has booked, so those slots show as taken. Not
// every VA can read every agent's rows; an empty list is the safe fallback.
export function useAgentTaken(agentId) {
  const q = useAgentBookings(agentId, { enabled: !!agentId && mode() === 'live', refetchInterval: false })
  const rows = q.data
  const isos = useMemo(() => openBookingIsos(rows, { stageOf }), [rows])
  return { isos, loading: !!agentId && q.isLoading }
}

// ── Checklist draft ────────────────────────────────────────────────────────
// There is no checklist-only save in migration 175 (the answers travel with
// the outcome), so each answer is kept on this device as it is picked and sent
// when the VA records an outcome.

const draftKey = leadId => `ohvara.va-desk.checklist.${leadId}`

function readDraft(leadId) {
  try { return JSON.parse(localStorage.getItem(draftKey(leadId)) || 'null') } catch { return null }
}

export function clearDraft(leadId) {
  try { localStorage.removeItem(draftKey(leadId)) } catch { /* private mode */ }
}

export function useChecklistDraft(row) {
  const leadId = row?.lead_id
  const [checklist, setChecklist] = useState(() => startingChecklist(row, readDraft(leadId)))
  const [status, setStatus] = useState({ state: 'idle', at: null })
  const [failed, setFailed] = useState(null)

  const write = useCallback(next => {
    try {
      localStorage.setItem(draftKey(leadId), JSON.stringify(next))
      setStatus({ state: 'saved', at: new Date() })
      setFailed(null)
    } catch {
      setStatus({ state: 'error', at: null })
      setFailed(next)
    }
  }, [leadId])

  const set = useCallback((key, value) => {
    const next = { ...checklist, [key]: value }
    setChecklist(next)
    write(next)
  }, [checklist, write])

  const retry = useCallback(() => { if (failed) write(failed) }, [failed, write])
  return { checklist, set, status, retry }
}

// ── The desk ───────────────────────────────────────────────────────────────

export function useVaDesk() {
  const qc = useQueryClient()
  const queue = useVaQueue()
  const roster = useVaRoster()
  const bookCall = useBookCall()
  const refresh = () => qc.invalidateQueries({ queryKey: KEY })

  // Takes a lead for 15 minutes. Resolves with the hold's end time.
  const claim = useMutation({
    mutationFn: async leadId => {
      if (import.meta.env.DEV && leadsSample()) {
        const { sampleClaim } = await import('../lib/vaSample')
        return sampleClaim(leadId)
      }
      const { data, error } = await supabase.rpc('va_claim', { p_lead: leadId })
      if (error) throw error
      return data
    },
    onSettled: refresh,
  })

  const release = useMutation({
    mutationFn: async leadId => {
      if (import.meta.env.DEV && leadsSample()) {
        const { sampleRelease } = await import('../lib/vaSample')
        return sampleRelease(leadId)
      }
      const { error } = await supabase.rpc('va_release', { p_lead: leadId })
      if (error) throw error
    },
    onSettled: refresh,
  })

  // not_reached | callback | transferred | booked (+ the booking row's id).
  const record = useMutation({
    mutationFn: async ({ leadId, outcome, agentId = null, callbackAt = null, bookingId = null, checklist = null }) => {
      if (import.meta.env.DEV && leadsSample()) {
        const { sampleRecord } = await import('../lib/vaSample')
        return sampleRecord(leadId)
      }
      const { error } = await supabase.rpc('va_set_lead_outcome', {
        p_lead: leadId,
        p_agent: agentId,
        p_outcome: outcome,
        p_callback_at: callbackAt ? callbackAt.toISOString() : null,
        p_booking_id: bookingId,
        p_checklist: checklist,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => clearDraft(v.leadId),
    onSettled: refresh,
  })

  // Book on the picked agent's calendar, then record it on the lead. If the
  // booking lands but the record doesn't, the error carries `bookingId` so the
  // retry only repeats the second step (no second booking).
  const book = useMutation({
    mutationFn: async ({ lead, agentId, scheduledAt, timezone, carrier, checklist, bookingId = null }) => {
      let id = bookingId
      if (!id && import.meta.env.DEV && leadsSample()) id = 'sample-booking'
      if (!id) {
        const { first, last } = splitName(lead.contact_name)
        const policy = await bookCall.mutateAsync({
          agentId,
          firstName: first || 'Unnamed',
          lastName: last || 'lead',
          phone: lead.phone || '',
          city: lead.city || '',
          state: lead.state || checklist?.state || '',
          timezone,
          carrierId: carrier?.id || null,
          currentCarrier: carrier?.name || checklist?.carrier || '',
          scheduledAt,
        })
        id = policy?.id
      }
      try {
        await record.mutateAsync({ leadId: lead.lead_id, outcome: 'booked', agentId, bookingId: id, checklist })
      } catch (err) {
        err.bookingId = id
        throw err
      }
      return id
    },
  })

  return { queue, roster, claim, release, record, book }
}
