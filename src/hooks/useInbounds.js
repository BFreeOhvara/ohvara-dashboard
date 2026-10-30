import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { byLead, isRecent, inboundActivityItems } from '../lib/inbounds'

// Data for the v2 agent portal (migration 180). Reads go through agent_inbounds() and
// RLS-limited selects; the agent's only writes are the two RPCs at the bottom. The lists
// refresh every 30 seconds, so a new inbound shows without a reload.
const LIVE = { refetchInterval: 30000 }
const EVENT_COLS = 'id, lead_id, kind, state, at, label, detail, actor_name, actor_role, created_at'

// Every inbound assigned to this agent (both products), newest first. `enabled: false` makes no
// agent_inbounds call at all (admin and Fulfillment never ask for it).
export function useInbounds({ enabled = true } = {}) {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['inbounds', profile?.id],
    enabled: !!profile?.id && enabled,
    ...LIVE,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('agent_inbounds')
      if (error) throw error
      return data || []
    },
  })
}

// How many inbounds came in today or yesterday: the badge on the sidebar's Inbounds, the phone
// More tab and More's Inbounds row. Same query (and key) as the Inbounds page.
export function useNewInboundCount() {
  const { profile } = useAuth()
  const { data } = useInbounds()
  return (data || []).filter(l => isRecent(l, profile?.timezone)).length
}

// Events the lists need across all of the agent's inbounds: every upcoming step, plus
// booked and reminder steps (appointment times, "reminder sent"). RLS keeps it to their leads.
export function useInboundEvents() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['inbound-events', 'all', profile?.id],
    enabled: !!profile?.id,
    ...LIVE,
    queryFn: async () => {
      const { data, error } = await supabase.from('inbound_events').select(EVENT_COLS)
        .or('state.eq.scheduled,kind.in.(booked,reminder,transferred)')
        .order('at', { ascending: true }).limit(1000)
      if (error) throw error
      return byLead(data)
    },
  })
}

// One day's finished steps across all of the agent's inbounds, for the Activity page and header line.
// `day` is a local-midnight Date, like usePolicyEvents. Scheduled and skipped steps are not events yet.
export function useInboundDayEvents(day, { enabled = true } = {}) {
  const { profile } = useAuth()
  const start = new Date(day)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const startISO = start.toISOString()
  return useQuery({
    queryKey: ['inbound-events', 'day', startISO, profile?.id],
    enabled: !!profile?.id && enabled,
    ...LIVE,
    queryFn: async () => {
      const { data, error } = await supabase.from('inbound_events').select(EVENT_COLS)
        .eq('state', 'done').neq('kind', 'note')
        .gte('at', startISO).lt('at', end.toISOString())
        .order('at', { ascending: false }).limit(1000)
      if (error) throw error
      return data || []
    },
  })
}

// The day's inbound steps as Activity items (agents only). Same events for the page and the header line.
export function useInboundActivity(day) {
  const { profile } = useAuth()
  const enabled = profile?.role === 'agent'
  const events = useInboundDayEvents(day, { enabled })
  const leads = useInbounds({ enabled })
  const items = inboundActivityItems(events.data, leads.data)
  return {
    items,
    isLoading: enabled && (events.isLoading || leads.isLoading),
    error: events.error || leads.error,
    refetch: () => { events.refetch(); leads.refetch() },
  }
}

// One inbound's whole timeline, done and scheduled.
export function useLeadEvents(leadId) {
  return useQuery({
    queryKey: ['inbound-events', 'lead', leadId],
    enabled: !!leadId,
    ...LIVE,
    queryFn: async () => {
      const { data, error } = await supabase.from('inbound_events').select(EVENT_COLS)
        .eq('lead_id', leadId).order('at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })
}

// Texts. The automated-text log and the replies are server tables; if the agent's role can't
// read one (or it isn't there yet) the card shows "No texts yet" instead of an error.
const soft = async q => {
  const { data, error } = await q
  return error ? [] : data || []
}

export function useLeadTexts(leadId) {
  return useQuery({
    queryKey: ['inbound-texts', leadId],
    enabled: !!leadId,
    retry: false,
    ...LIVE,
    queryFn: async () => {
      const [sent, replies] = await Promise.all([
        soft(supabase.from('lead_followup_sms_log').select('id, stage, status, created_at')
          .eq('lead_id', leadId).eq('status', 'sent').order('created_at', { ascending: true })),
        soft(supabase.from('lead_sms_replies').select('id, body, received_at')
          .eq('lead_id', leadId).order('received_at', { ascending: true })),
      ])
      return [
        ...sent.map(s => ({ id: `s-${s.id}`, mine: true, stage: s.stage, at: s.created_at })),
        ...replies.map(r => ({ id: `r-${r.id}`, mine: false, body: r.body, at: r.received_at })),
      ].sort((a, b) => new Date(a.at) - new Date(b.at))
    },
  })
}

// Replies nobody has handled yet, newest first (Today's "Texts waiting").
export function useWaitingTexts() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['inbound-texts', 'waiting', profile?.id],
    enabled: !!profile?.id,
    retry: false,
    ...LIVE,
    queryFn: () => soft(supabase.from('lead_sms_replies').select('id, lead_id, body, received_at')
      .is('handled_at', null).not('lead_id', 'is', null).order('received_at', { ascending: false }).limit(20)),
  })
}

// Plan usage: the agent's membership tier (membership_tiers, migration 180). The tier is named by
// profiles.membership_tier; nothing sets that yet, so until it does the card shows its "no number" state.
export function useMembershipTier() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['membership-tiers'],
    enabled: !!profile?.id,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('membership_tiers').select('key, name, monthly_appointments, is_active')
        .eq('is_active', true).order('sort_order')
      if (error) return []
      return data || []
    },
    select: tiers => tiers.find(t => t.key === profile?.membership_tier) || null,
  })
}

// ── Writes ───────────────────────────────────────────────────────────────────
function refresh(qc, leadId) {
  qc.invalidateQueries({ queryKey: ['inbounds'] })
  qc.invalidateQueries({ queryKey: ['inbound-events'] })
  if (leadId) qc.invalidateQueries({ queryKey: ['inbound-events', 'lead', leadId] })
}

// Sold / Follow up / Not interested. Resolves to the new inbound_stage.
export function useSetOutcome(leadId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ outcome, note }) => {
      const { data, error } = await supabase.rpc('set_inbound_outcome', { p_lead: leadId, p_outcome: outcome, p_note: note ?? null })
      if (error) throw error
      return data
    },
    onSuccess: () => refresh(qc, leadId),
  })
}

export function useAddNote(leadId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async note => {
      const { data, error } = await supabase.rpc('add_inbound_note', { p_lead: leadId, p_note: note })
      if (error) throw error
      return data
    },
    onSuccess: () => refresh(qc, leadId),
  })
}
