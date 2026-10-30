import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { hoursFresh, FALLBACK_HOURS } from '../lib/carriers'

// Carrier directory (migration 072). Prompt 728 (migrations 132/133) made it
// the type-ahead behind Book a call's "Carrier they're leaving": every US life
// carrier by name + aliases, with each one's policyholder service hours,
// filled in lazily by the carrier-hours edge function.

export function useCarriers() {
  return useQuery({
    queryKey: ['carriers'],
    staleTime: 5 * 60e3,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .order('name')
      if (error) throw error
      return data || []
    },
  })
}

// Put a changed row back into the cached directory without a refetch.
function patchCarriers(qc, row) {
  if (!row?.id) return
  qc.setQueryData(['carriers'], list => {
    if (!list) return list
    const i = list.findIndex(c => c.id === row.id)
    if (i < 0) return [...list, row].sort((a, b) => a.name.localeCompare(b.name))
    const next = list.slice()
    next[i] = { ...next[i], ...row }
    return next
  })
}

async function invokeHours(body) {
  const { data, error } = await supabase.functions.invoke('carrier-hours', { body })
  if (error) throw error
  if (!data?.carrier) throw new Error(data?.error || 'No answer from the hours lookup')
  return data
}

// Prompt 728 — the picked carrier's hours. Cached hours (under 180 days old)
// are used as they are; otherwise the carrier-hours function returns them
// (looking them up once if needed). If that call fails, Mon–Fri 9–5 ET stands
// in for this booking so the agent is never stuck.
// Returns { carrier (with hours), checking, lookupOff }.
export function useCarrierHours(carrier) {
  const qc = useQueryClient()
  const fresh = hoursFresh(carrier)
  const q = useQuery({
    queryKey: ['carrier-hours', carrier?.id],
    enabled: !!carrier?.id && !fresh,
    staleTime: Infinity,
    retry: 0,
    queryFn: async () => {
      try {
        const data = await invokeHours({ carrier_id: carrier.id })
        const row = data.carrier
        if (!row.hours || !row.hours_tz) throw new Error(data.error || 'No hours came back')
        if (!data.lookup_off) patchCarriers(qc, row)
        return { carrier: row, lookupOff: !!data.lookup_off }
      } catch {
        return { carrier: { ...carrier, ...FALLBACK_HOURS, hours_status: 'fallback' }, lookupOff: false, failed: true }
      }
    },
  })
  if (!carrier) return { carrier: null, checking: false }
  if (fresh) return { carrier, checking: false }
  if (!q.data) return { carrier: null, checking: true }
  return { carrier: q.data.carrier, checking: false, lookupOff: q.data.lookupOff }
}

// "Use "<text>"": add a carrier the directory doesn't have (or get the row
// whose name / alias already matches). Status 'pending' until looked up.
export function useAddCarrier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async name => {
      const { data, error } = await supabase.rpc('carrier_add', { p_name: name })
      if (error) throw error
      return data
    },
    onSuccess: row => patchCarriers(qc, row),
  })
}

// Admin: "Look up again" (always runs the live lookup, even with the agents'
// switch off). Returns the function's whole answer (model, usage, note).
export function useLookupCarrier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async id => invokeHours({ carrier_id: id, force: true }),
    onSuccess: data => {
      patchCarriers(qc, data.carrier)
      qc.removeQueries({ queryKey: ['carrier-hours', data.carrier?.id] })
    },
  })
}

// Prompt 728 — give an older booking the carrier it's leaving (My Pipeline
// Move / Re-book), so its new time follows that carrier's hours.
export function useSetBookingCarrier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ policyId, carrierId }) => {
      const { error } = await supabase.rpc('agent_set_booking_carrier', { p_policy: policyId, p_carrier: carrierId })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}

export function useSaveCarrier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const q = id
        ? supabase.from('carriers').update(fields).eq('id', id)
        : supabase.from('carriers').insert(fields)
      const { data, error } = await q.select().single()
      if (error) throw error
      return data
    },
    onSuccess: row => {
      patchCarriers(qc, row)
      qc.removeQueries({ queryKey: ['carrier-hours', row?.id] })
    },
  })
}

export function useDeleteCarrier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('carriers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['carriers'] }),
  })
}
