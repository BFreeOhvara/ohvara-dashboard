import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { isMissing } from './agentRealData'
import { readGhlSettings, readGhlKeySaved } from '../lib/ghlConnect'
import { buildAdmState, realClock, SWITCH_HOME } from '../lib/admReal'
import { useNote } from '../template/kit'

// P858 — the Admin portal on real data. Same store shape as the sample door (src/adminshell/data.js), read from the
// tables and RPCs that already exist, under RLS (admins read everything). A table or function that isn't on the
// database yet reads as empty (a designed empty state), never sample and never an error; a real failure of one
// source is listed in meta.failed and the page says so, while the rest still shows. Writes go only through existing
// server functions (and 232's once applied). Nothing here texts, emails, dials or moves money by itself; inviting
// and the switches do what the classic admin pages already do. Mappers: lib/admReal.js.
export const ADM_KEY = ['p858', 'admin']
const COLS_LEAD = ['id', 'contact_name', 'business_name', 'phone', 'state', 'city', 'lead_type', 'lead_source', 'inbound_product', 'inbound_stage', 'outcome', 'transfer_status', 'va_outcome', 'assigned_rep_id', 'created_at', 'delivered_at', 'appointment_at', 'is_sample'].join(', ')
const COLS_POLICY = 'id, agent_id, client_first_name, client_last_name, client_phone, state, carrier_name, product_name, product_type, policy_number, monthly_premium, status, cancellation_status, cancellation_substatus, pending_underwriting, next_lapse_check_at, policy_sold_date, created_at, fulfillment_assigned, assigned_fulfillment_id, scheduled_call_at, call_live_since, fulfillment_stage'

// One source: missing (not migrated yet) = fallback; any other error is noted and the fallback shown.
async function src(name, q, fallback, failed) {
  try {
    const { data, error } = await q
    if (error) { if (!isMissing(error)) failed.push(name); return fallback }
    return data ?? fallback
  } catch (e) {
    if (!isMissing(e)) failed.push(name)
    return fallback
  }
}

export async function loadAdmin(sb, clock) {
  const failed = []
  const weekStart = `${clock.weekStartIso}T00:00:00-06:00`
  const lastMonthStart = (() => { const [y, m] = clock.monthStartIso.split('-').map(Number); return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01` })()
  const dayBefore = iso => new Date(Date.parse(`${iso}T12:00:00Z`) - 864e5).toISOString().slice(0, 10)
  const [profiles, leadSettings, onDuty, accounts, invites, leads, unassigned, policies, steps, threads, messages, bugs, audit, app, rc,
    campaigns, costsWeek, costsMonth, costsLast, runs, ticks, dayOff, ghl, keySaved] = await Promise.all([
    src('people', sb.rpc('admin_list_profiles'), [], failed),
    src('lead settings', sb.from('agent_lead_settings').select('agent_id, active, states'), [], failed),
    src('on duty', sb.rpc('on_duty_agents'), [], []),
    src('payout accounts', sb.from('fulfillment_payout_accounts').select('*'), [], []),
    src('invites', sb.from('rep_invites').select('id, role, created_at, expires_at, channel, invited_email, invited_phone').is('used_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }), [], failed),
    src('leads', sb.from('leads').select(COLS_LEAD).in('lead_type', ['mortgage_protection', 'policy_help']).gte('created_at', weekStart).order('created_at').limit(1000), [], failed),
    src('unassigned', sb.from('leads').select(COLS_LEAD).in('lead_type', ['mortgage_protection', 'policy_help']).is('assigned_rep_id', null).order('created_at', { ascending: false }).limit(200), [], failed),
    src('clients', sb.from('policies').select(COLS_POLICY).is('archived_at', null).order('created_at', { ascending: false }).limit(1000), [], failed),
    src('servicing', sb.from('servicing_tasks').select('id, policy_id, kind, status, due_at, done_at').is('done_at', null).limit(500), [], []),
    src('threads', sb.rpc('my_standing_threads'), [], []),
    src('messages', sb.from('direct_messages').select('id, agent_id, peer_key, sender_id, sender_role, body, created_at').eq('peer_key', 'admin').order('created_at', { ascending: false }).limit(500), [], []),
    src('bug reports', sb.from('bug_reports').select('id, description, screenshot_url, page_url, status, created_at, reporter:profiles!bug_reports_reporter_id_fkey(id, full_name)').order('created_at', { ascending: false }).limit(100), [], failed),
    src('audit log', sb.from('admin_audit_log').select('id, at, actor, actor_name, via, action, target_table, target_id').order('at', { ascending: false }).limit(100), [], failed),
    src('settings', sb.from('app_settings').select('*').eq('id', 1).maybeSingle(), null, failed),
    src('switches', sb.from('recovery_config').select('*').eq('id', true).maybeSingle(), null, []),
    src('campaigns', sb.from('ghl_campaign_agents').select('*').order('last_seen_at', { ascending: false }), [], []),
    src('ad costs', sb.rpc('admin_ad_costs', { p_from: clock.weekStartIso, p_to: clock.todayIso }), [], []),
    src('ad costs', sb.rpc('admin_ad_costs', { p_from: clock.monthStartIso, p_to: clock.todayIso }), [], []),
    src('ad costs', sb.rpc('admin_ad_costs', { p_from: lastMonthStart, p_to: dayBefore(clock.monthStartIso) }), [], []),
    src('pay runs', sb.from('fulfillment_pay_runs').select('id, pay_date, period_start, status, paid_cents, paid_reps').gt('paid_cents', 0).order('pay_date', { ascending: false }).limit(8), [], []),
    src('setup ticks', sb.from('agent_setup_ticks').select('agent_id, step, done_at'), [], []),
    src('days off', sb.from('va_day_off_requests').select('id, va_id, off_date, reason, status, created_at').order('created_at', { ascending: false }).limit(50), [], []),
    readGhlSettings(sb).catch(() => null),
    readGhlKeySaved(sb).catch(() => false),
  ])
  const leadIds = [...leads, ...unassigned].map(l => l.id)
  const intake = leadIds.length ? await src('intake', sb.from('lead_intake').select('lead_id, routing, meta_option, agent_ref, campaign_id').in('lead_id', leadIds.slice(0, 300)), [], []) : []
  return {
    profiles, leadSettings, onDuty: (onDuty || []).map(r => r.agent_id || r.id).filter(Boolean), accounts, invites, leads, unassigned, intake, policies, steps,
    threads, messages: (messages || []).slice().reverse(), bugs, audit, app, rc, campaigns, costsWeek, costsMonth, costsLast, runs, ticks, dayOff, ghl, keySaved, failed: [...new Set(failed)],
  }
}

function useTick(ms) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

// The real store: { ...same keys as the sample store, meta: { isLoading, error, failed, retry } }.
export function useAdmRealState(base) {
  const { profile } = useAuth()
  const now = useTick(60000)
  const clock = useMemo(() => realClock(now), [now])
  const q = useQuery({ queryKey: [...ADM_KEY, clock.weekStartIso], enabled: !!profile?.id, refetchInterval: 60000, queryFn: () => loadAdmin(supabase, clock) })
  return useMemo(() => {
    const s = buildAdmState(q.data || {}, { now, clock, me: profile, base })
    const failed = q.data?.failed || []
    return { ...s, meta: { isLoading: q.isLoading, error: q.error || (failed.includes('people') ? new Error('Could not load people') : null), failed, retry: q.refetch } }
  }, [q.data, q.isLoading, q.error, q.refetch, now, clock, profile, base])
}

// The real writes, same names as the sample actions. Each one is fire-and-forget like the sample (screens show their
// own note); a failure shows "Could not save" and the data reloads. Actions with no backend yet say so and change
// nothing (they are on the door list in brain/ohvara/admin-backend-map.md).
export function useAdmRealActions() {
  const qc = useQueryClient()
  const note = useNote()
  const { profile } = useAuth()
  return useMemo(() => {
    const reload = () => qc.invalidateQueries({ queryKey: ADM_KEY })
    const run = (p, failWord = 'Could not save. Nothing changed') => Promise.resolve(p).then(r => {
      if (r?.error) throw r.error
      reload()
      return r
    }).catch(e => {
      note(isMissing(e) ? 'This needs a database update first (on the door list). Nothing changed' : `${failWord}${e?.message ? `: ${e.message}` : ''}`)
      reload()
    })
    const notYet = what => () => note(`${what} isn't on real data yet (on the door list). Nothing changed`)
    const rpc = (fn, args) => run(supabase.rpc(fn, args))
    return {
      assignLead: (id, agentId) => rpc('admin_assign_lead', { p_lead: id, p_agent: agentId }),
      setLeadStage: notYet('Changing a lead stage from admin'),
      setAgentActive: (id, on) => run(supabase.from('agent_lead_settings').update({ active: on, updated_at: new Date().toISOString() }).eq('agent_id', id)),
      setAgentSpend: notYet('Changing a weekly lead budget from admin'),
      setServicing: (id, on) => run(supabase.from('profiles').update({ has_servicing: on }).eq('id', id)),
      setComped: (id, on) => run(supabase.from('profiles').update({ billing_exempt: on }).eq('id', id)),
      setAccess: (id, on) => rpc('admin_set_user_access', { p_user: id, p_active: on, p_confirm: true }),
      setRole: (id, role) => rpc('admin_set_user_role', { p_user: id, p_role: role, p_confirm: true }),
      // The existing invite flow: an email or text goes through send-agent-invite (what the classic page does); a link
      // is a rep_invites row the admin copies.
      invite: ({ role, via, to }) => (via === 'link'
        ? run((async () => {
          const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
          const bytes = new Uint8Array(12)
          crypto.getRandomValues(bytes)
          const token = Array.from(bytes, b => ALPHABET[b % 64]).join('')
          return supabase.from('rep_invites').insert({ token, role, created_by: profile?.id })
        })())
        : run(supabase.functions.invoke('send-agent-invite', { body: { action: 'send', channel: via === 'text' ? 'sms' : 'email', to, role } }), 'Could not send the invite')),
      resendInvite: notYet('Resending an invite'),
      cancelInvite: id => run(supabase.from('rep_invites').delete().eq('id', id)),
      tickSetup: (id, key, on) => rpc('admin_setup_tick', { p_agent: id, p_step: key, p_on: on }),
      markLaunched: id => run(Promise.all(['campaign', 'budget', 'mapped', 'link', 'tracking', 'workflows']
        .map(k => supabase.rpc('admin_setup_tick', { p_agent: id, p_step: k, p_on: true }))).then(rs => rs.find(r => r.error) || rs[0])),
      markLive: id => rpc('admin_mark_live', { p_agent: id }),
      resendSetupInvite: notYet('Resending a setup invite'),
      giveCall: (callId, vaId) => rpc('admin_give_call', { p_policy: callId, p_to: vaId }),
      giveStep: notYet('Giving a servicing step to a VA'),
      addShift: notYet('The rota'), removeShift: notYet('The rota'), moveShift: notYet('The rota'),
      decideDayOff: (id, approve) => rpc('va_decide_day_off', { p_request: id, p_approve: approve }),
      setSplit: notYet('The profit split'),
      setPaused: on => run(supabase.from('recovery_config').update({ payouts_paused: on }).eq('id', true)),
      setSwitch: (key, on) => {
        const home = SWITCH_HOME[key]
        if (!home) { note('This switch has no database column yet (on the door list). Nothing changed'); return }
        const [table, col] = home
        run(table === 'app_settings' ? supabase.from('app_settings').update({ [col]: on }).eq('id', 1) : supabase.from('recovery_config').update({ [col]: on }).eq('id', true))
      },
      savePayRules: notYet('The hourly pay rule'),
      saveBilling: notYet('Lead billing settings'), setMaxDaily: notYet('Raising a max daily spend'),
      saveSettings: patch => (patch?.liveRoom !== undefined ? run(supabase.from('app_settings').update({ daily_room_url: patch.liveRoom }).eq('id', 1)) : undefined),
      setTz: tz => run(supabase.from('profiles').update({ timezone: tz }).eq('id', profile?.id)),
      setBugStatus: (id, status) => run(supabase.from('bug_reports').update({ status: status === 'fixed' ? 'resolved' : 'new' }).eq('id', id)),
      sendMessage: (threadId, text) => {
        const agentId = String(threadId).split('.')[0]
        return run(supabase.from('direct_messages').insert({ agent_id: agentId, peer_id: null, sender_id: profile?.id, body: text }), 'Could not send')
      },
      readThread: threadId => {
        const agentId = String(threadId).split('.')[0]
        run(supabase.from('direct_message_reads').upsert({ agent_id: agentId, peer_key: 'admin', profile_id: profile?.id, last_read_at: new Date().toISOString() }, { onConflict: 'agent_id,peer_key,profile_id' }))
      },
      // Connect on real data: the location and workflow IDs (ghl_settings), and the campaign → agent map (232).
      saveConnect: (part, patch) => {
        if (part === 'ghl') {
          const p = {}
          if (patch.locationId !== undefined) p.location_id = patch.locationId || null
          if (patch.workflows) { p.workflow_new_inbound = patch.workflows.newLead || null; p.workflow_appointment_reminder = patch.workflows.reminder || null; p.workflow_no_show = patch.workflows.noShow || null }
          if (!Object.keys(p).length) { note('The GoHighLevel key is saved from the key box. Nothing else changed'); return }
          return run(supabase.from('ghl_settings').update(p).eq('id', true))
        }
        note('That part of Connect is GoHighLevel\'s (not connected yet). Nothing changed')
      },
      mapCampaign: (campaignId, agentId, leadType = 'appts') => rpc('admin_map_campaign', { p_campaign: campaignId, p_agent: agentId, p_lead_type: leadType }),
    }
  }, [qc, note, profile?.id])
}
