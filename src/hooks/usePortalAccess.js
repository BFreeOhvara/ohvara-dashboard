import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { invokeBilling, portalState, gateView } from '../lib/billing'
import { isNativeApp } from '../lib/native'
import { useAuth } from './useAuth'
import { useAppSettings } from './useAppSettings'

// Dev only: ?portalstub=none|servicing|leads|leads_only|unknown|invited feeds the
// rule without a database, and sticks for the tab so links keep the state
// (?portalstub=off clears it). The whole branch drops out of a production build.
function devStub() {
  if (!import.meta.env.DEV) return null
  const asked = new URLSearchParams(window.location.search).get('portalstub')
  if (asked) sessionStorage.setItem('portalstub', asked)
  const stub = sessionStorage.getItem('portalstub')
  const access = (servicing, leads) => ({ self: true, servicing, leads, unlocked: servicing || leads })
  return {
    none: { access: access(false, false) },
    servicing: { access: access(true, false) },
    leads: { access: access(true, true) },
    leads_only: { access: access(false, true) },
    unknown: { access: 'unknown' },
    invited: { invited: true, access: null },
  }[stub] || null
}

// Self-signup agents only: agent_portal_access says what they've paid for.
// { access, loading, check, profile }: access is the RPC's jsonb, 'unknown' when
// the RPC or the columns are missing or it errored, null for everyone else (and
// while loading). Never throws, and an invited agent never calls it.
export function usePortalAccess(realProfile) {
  const stub = devStub()
  const profile = stub && realProfile?.role === 'agent'
    ? { ...realProfile, signup_source: stub.invited ? 'invite' : 'self' }
    : realProfile
  const self = profile?.role === 'agent' && profile.signup_source === 'self' && !profile.billing_exempt

  const q = useQuery({
    // The billing columns are in the key: when a page refreshes the profile after
    // a payment (Billing does), the answer is read again.
    queryKey: ['portal-access', profile?.id, profile?.billing_status, profile?.billing_current_period_end, profile?.billing_grace_until, profile?.leads_status],
    enabled: !!self && !stub,
    placeholderData: prev => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('agent_portal_access')
      if (error) throw error
      return data
    },
  })

  // One look: heal from Stripe, then ask again. Resolves to the new access value.
  const check = async () => {
    if (stub) return stub.access
    await invokeBilling('status').catch(() => {})
    const r = await q.refetch()
    return r.isError ? 'unknown' : r.data
  }

  if (!self) return { profile, access: null, loading: false, check }
  if (stub) return { profile, access: stub.access, loading: false, check }
  return { profile, access: q.isError ? 'unknown' : q.data ?? null, loading: q.isPending, check }
}

// The "You're in" moment: one time, in memory, so a reload shows the normal Overview.
const momentKey = id => ['portal-unlocked-moment', id]

// The rule, the view for this page and the moves the gate needs. view:
//   open | paused | welcome | servicing   gateView
//   loading    a self-signup's answer isn't in yet: nothing rather than a flash
//   confirm    back from Stripe (?session_id on /agent)
//   unlocked   the "You're in" moment
export function usePortal() {
  const { profile: realProfile, refreshProfile } = useAuth()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { profile, access, loading, check } = usePortalAccess(realProfile)
  const { data: settings } = useAppSettings()
  const state = portalState(profile, access, settings)

  const { data: moment } = useQuery({
    queryKey: momentKey(profile?.id), queryFn: () => false, initialData: false, enabled: false,
  })
  const setMoment = useCallback(on => qc.setQueryData(momentKey(profile?.id), on), [qc, profile?.id])

  const onHome = pathname === '/agent' && state.self
  let view = gateView(state, pathname)
  if (onHome && moment) view = 'unlocked'
  else if (onHome && !isNativeApp() && new URLSearchParams(search).has('session_id')) view = 'confirm'
  else if (loading) view = 'loading'

  // Paid: pick up the new profile and whatever was closed while locked (no reload).
  const refreshAll = useCallback(async () => {
    await refreshProfile()
    await qc.invalidateQueries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc])

  // Back from checkout and it went through: the moment, on a clean /agent.
  const unlock = useCallback(async () => {
    setMoment(true)
    navigate('/agent', { replace: true })
    await refreshAll()
  }, [setMoment, navigate, refreshAll])

  return { ...state, profile, loading, view, check, unlock, refreshAll, setMoment, moment }
}

// Leaving the moment for another page ends it.
export function useEndMomentOffHome(portal) {
  const { pathname } = useLocation()
  const { moment, setMoment } = portal
  useEffect(() => {
    if (moment && pathname !== '/agent') setMoment(false)
  }, [moment, setMoment, pathname])
}
