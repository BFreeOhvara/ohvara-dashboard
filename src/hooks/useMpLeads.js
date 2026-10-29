import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { leadsSample } from '../lib/leadsPage'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../lib/timezones'
import { useAuth } from './useAuth'

// Meta mortgage-protection leads delivered to this agent: leads rows with
// lead_type 'mortgage_protection' (migration 166). RLS already limits leads to
// assigned_rep_id = auth.uid() (admin sees all), so the explicit filter is for
// admins who open the page: they see their own. The agent's status is
// leads.agent_status (161); the qualifier answers sit in qualifier_answers.
// ?sample=1 (dev + VITE_LEADS_PAGE only) reads src/lib/leadsSample.js instead.
const MP_LEAD_TYPE = 'mortgage_protection'
const LEAD_COLS = 'id, created_at, contact_name, phone, state, qualifier_answers, agent_status, delivered_at'
export const LEAD_LIMIT = 200
const STATUS_KEY = ['leads', MP_LEAD_TYPE, 'status']
const mode = () => (import.meta.env.DEV && leadsSample() ? 'sample' : 'live')
const leadsKey = id => ['leads', MP_LEAD_TYPE, id, mode()]
const settingsKey = id => ['agent_lead_settings', id, mode()]

// One leads row in the shape the Leads page reads.
const toLead = ({ contact_name, qualifier_answers: qa, agent_status, delivered_at, ...l }) => ({
  ...l,
  first_name: contact_name,
  last_name: null,
  age_band: qa?.age_band ?? null,
  mortgage_balance_band: qa?.mortgage_balance_band ?? null,
  homeowner: qa?.homeowner ?? null,
  smoker: qa?.smoker ?? null,
  best_time: qa?.best_time ?? null,
  status: agent_status ?? 'assigned',
  assigned_at: delivered_at,
})

// When a lead reached this agent: assigned_at, else created_at.
export const leadTime = l => l.assigned_at || l.created_at

// Leads delivered this week, Monday to Sunday in the agent's time zone.
export function weekCount(leads, tz = DEFAULT_TIMEZONE) {
  const monday = new Date(`${zonedDateStr(Date.now(), tz)}T12:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const from = monday.toISOString().slice(0, 10)
  return leads.filter(l => leadTime(l) && zonedDateStr(new Date(leadTime(l)).getTime(), tz) >= from).length
}

export function useMpLeads() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: leadsKey(profile?.id),
    queryFn: async () => {
      if (import.meta.env.DEV && leadsSample()) {
        const { sampleLeads } = await import('../lib/leadsSample')
        return sampleLeads()
      }
      const { data, error } = await supabase
        .from('leads')
        .select(LEAD_COLS)
        .eq('lead_type', MP_LEAD_TYPE)
        .eq('assigned_rep_id', profile.id)
        .order('delivered_at', { ascending: false, nullsFirst: false })
        .limit(LEAD_LIMIT)
      if (error) throw error
      return data.map(toLead)
    },
    enabled: !!profile?.id,
    // New leads show up without a refresh.
    refetchInterval: 60_000,
  })
}

// Agents change agent_status only, to assigned/contacted/closed/bad, on their
// own leads (leads_rep_update: assigned_rep_id = auth.uid()). Never
// leads.status: that is the cancellation pipeline and feeds the rep queues.
// Each lead card owns one of these, so isPending is that card's busy state.
// Optimistic: the lead flips in the cache at once; on error only that lead
// goes back to its old status. The list refetches only once the last save in
// flight settles, so a refetch can't undo another card's pending change.
export function useUpdateMpLeadStatus() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const key = leadsKey(profile?.id)
  const setStatus = (id, status) =>
    qc.setQueryData(key, rows => rows?.map(l => (l.id === id ? { ...l, status } : l)))
  return useMutation({
    mutationKey: STATUS_KEY,
    mutationFn: async ({ id, status }) => {
      if (!['assigned', 'contacted', 'closed', 'bad'].includes(status)) throw new Error('Bad status')
      if (import.meta.env.DEV && leadsSample()) {
        const { sampleSetStatus } = await import('../lib/leadsSample')
        return sampleSetStatus(id, status)
      }
      const { error } = await supabase.from('leads').update({ agent_status: status })
        .eq('id', id).eq('lead_type', MP_LEAD_TYPE).eq('assigned_rep_id', profile.id)
      if (error) throw error
    },
    onMutate: async ({ id, status, from }) => {
      await qc.cancelQueries({ queryKey: key })
      setStatus(id, status)
      return { id, from }
    },
    onError: (_e, _v, ctx) => ctx && setStatus(ctx.id, ctx.from),
    // This mutation still counts as in flight here, hence <= 1.
    onSettled: () => qc.isMutating({ mutationKey: STATUS_KEY }) <= 1 && qc.invalidateQueries({ queryKey: key }),
  })
}

export function useLeadSettings() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: settingsKey(profile?.id),
    queryFn: async () => {
      if (import.meta.env.DEV && leadsSample()) {
        const { sampleSettings } = await import('../lib/leadsSample')
        return sampleSettings()
      }
      const { data, error } = await supabase
        .from('agent_lead_settings')
        .select('active, states, daily_cap')
        .eq('agent_id', profile.id)
        .maybeSingle()
      if (error) throw error
      return data || null // null = no row yet (first save inserts)
    },
    enabled: !!profile?.id,
  })
}

// Upserts the agent's own row: insert the first time, update after that. Not
// a PostgREST upsert: agent_id is not in the update column grant, and an
// upsert's ON CONFLICT DO UPDATE would try to set it.
export function useSaveLeadSettings() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ values, exists }) => {
      const row = { active: values.active, states: values.states, daily_cap: values.daily_cap }
      if (import.meta.env.DEV && leadsSample()) {
        const { sampleSaveSettings } = await import('../lib/leadsSample')
        return sampleSaveSettings(row)
      }
      const q = supabase.from('agent_lead_settings')
      const { error } = exists
        ? await q.update({ ...row, updated_at: new Date().toISOString() }).eq('agent_id', profile.id)
        : await q.insert({ agent_id: profile.id, ...row })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKey(profile?.id) }),
  })
}
