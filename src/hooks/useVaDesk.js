import { useCallback, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAgentBookings, useBookCall } from './useAgentBookings'
import { stageOf } from '../lib/agentBookings'
import { openBookingIsos } from '../lib/scheduling'
import { splitName, startingChecklist } from '../lib/vaQueue'
import { isDutyMissing } from '../lib/duty'

// VA desk (/fulfillment/leads). Every read and write goes through the
// migration-175 functions (va_queue, va_agent_roster, va_claim, va_release,
// va_set_lead_outcome) and 208's (va_missed_leads, va_next_open_slot,
// va_agent_in_hours); nothing writes `leads` directly.
//
// A booking is the same policies row Book a call writes (useBookCall, for the
// agent the VA picked) and then va_set_lead_outcome('booked') ties it to the
// lead. A transfer is only a record. Nothing here texts, emails or calls
// anyone: there is no send path in this file.

const KEY = ['va-desk']

// The queue: new, not reached and callbacks that are due. Polled so another
// VA's claim or a new lead shows without a refresh.
export function useVaQueue() {
  return useQuery({
    queryKey: [...KEY, 'queue'],
    refetchInterval: 30e3,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('va_queue')
      if (error) throw error
      return data || []
    },
  })
}

// Live transfers nobody answered, each with the agent it books onto. Until 208
// is applied the function is missing: an empty list, so the desk looks as it did.
export function useVaMissed() {
  return useQuery({
    queryKey: [...KEY, 'missed'],
    refetchInterval: 30e3,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('va_missed_leads')
      if (error) {
        if (isDutyMissing(error)) return []
        throw error
      }
      return data || []
    },
  })
}

// The first free slot in the next hour inside the lead's agent's hours, or null.
export function useVaNextSlot(leadId) {
  return useQuery({
    queryKey: [...KEY, 'next-slot', leadId],
    refetchInterval: 60e3,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('va_next_open_slot', { p_lead: leadId })
      if (error) {
        if (isDutyMissing(error)) return null
        throw error
      }
      return data || null
    },
  })
}

// Active agents a VA can pick (id + name). A plain list: the on-duty toggle
// isn't built yet.
export function useVaRoster() {
  return useQuery({
    queryKey: [...KEY, 'roster'],
    staleTime: 60e3,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('va_agent_roster')
      if (error) throw error
      return data || []
    },
  })
}

// The times an agent already has booked, so those slots show as taken. Not
// every VA can read every agent's rows; an empty list is the safe fallback.
export function useAgentTaken(agentId) {
  const q = useAgentBookings(agentId, { enabled: !!agentId, refetchInterval: false })
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
  const missed = useVaMissed()
  const bookCall = useBookCall()
  const refresh = () => qc.invalidateQueries({ queryKey: KEY })

  // Takes a lead for 15 minutes. Resolves with the hold's end time.
  const claim = useMutation({
    mutationFn: async leadId => {
      const { data, error } = await supabase.rpc('va_claim', { p_lead: leadId })
      if (error) throw error
      return data
    },
    onSettled: refresh,
  })

  const release = useMutation({
    mutationFn: async leadId => {
      const { error } = await supabase.rpc('va_release', { p_lead: leadId })
      if (error) throw error
    },
    onSettled: refresh,
  })

  // not_reached | callback | transferred | booked (+ the booking row's id).
  const record = useMutation({
    mutationFn: async ({ leadId, outcome, agentId = null, callbackAt = null, bookingId = null, checklist = null }) => {
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
  // retry only repeats the second step (no second booking). The agent's hours
  // are checked first: once the row is written it is on their calendar, and a
  // VA can't take it back off.
  const book = useMutation({
    mutationFn: async ({ lead, agentId, scheduledAt, timezone, carrier, checklist, bookingId = null }) => {
      let id = bookingId
      if (!id) {
        const { data: inHours, error: hoursErr } = await supabase.rpc('va_agent_in_hours', {
          p_agent: agentId,
          p_at: new Date(scheduledAt).toISOString(),
        })
        if (hoursErr && !isDutyMissing(hoursErr)) throw hoursErr
        if (!hoursErr && !inHours) {
          throw Object.assign(new Error("That's outside this agent's working hours. Pick another time."), { hint: 'working_hours' })
        }
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

  return { queue, roster, missed, claim, release, record, book }
}
