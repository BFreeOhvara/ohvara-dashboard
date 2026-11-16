import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { SAMPLE_TYPES, byOrder, visibleTypes, centralToday } from '../lib/coverageTypes'

// P1016 — the lead types list and the signed-in agent's pick (migration 281). `real` comes from the caller: the agent
// template's useDataSource() === 'real', the admin shell's useAdmSource() === 'real', or true on the real sign-up. Real
// reads coverage_types and agent_coverage and writes through coverage_type_set / admin_coverage_type_*; sample keeps
// both in memory so the screens work for test accounts and previews. The Supabase client is imported only when real,
// so /template (no backend, no providers) never loads it. One small store per tab, shared by every screen.

const sb = () => import('../lib/supabase').then(m => m.supabase)

const store = {
  types: SAMPLE_TYPES, loaded: false, loading: null,
  mine: { key: null, nextKey: null, nextFrom: null, loaded: false, uid: null },
  sampleMine: { key: 'mortgage_protection', nextKey: null, nextFrom: null, loaded: true },
  subs: new Set(),
}
let snap = { types: store.types, mine: store.mine, sampleMine: store.sampleMine }
const emit = () => { snap = { types: store.types, mine: store.mine, sampleMine: store.sampleMine }; store.subs.forEach(f => f()) }
const subscribe = f => { store.subs.add(f); return () => store.subs.delete(f) }
const read = () => snap
const fromRow = (d, uid) => ({ key: d?.types?.[0] ?? null, nextKey: d?.next_types?.[0] ?? null, nextFrom: d?.next_from ?? null, loaded: true, uid })

function loadTypes(force = false) {
  if (store.loading && !force) return store.loading
  store.loading = sb().then(db => db.from('coverage_types').select('key, label, words, blurb, sort, hidden, most_popular'))
    .then(({ data, error }) => {
      if (!error && Array.isArray(data) && data.length) { store.types = byOrder(data); store.loaded = true; emit() }
    }).catch(() => {})
  return store.loading
}

let mineLoading = null
function loadMine() {
  if (mineLoading) return mineLoading
  mineLoading = sb().then(async db => {
    const uid = (await db.auth.getSession())?.data?.session?.user?.id
    if (!uid) return
    const { data, error } = await db.from('agent_coverage').select('types, next_types, next_from').eq('agent_id', uid).maybeSingle()
    if (!error) { store.mine = fromRow(data, uid); emit() }
  }).catch(() => {}).finally(() => { mineLoading = null })
  return mineLoading
}

// The list (all of it for admins; `visible` = what agents can pick).
export function useCoverageTypes(real = false) {
  const s = useSyncExternalStore(subscribe, read, read)
  useEffect(() => { if (real && !store.loaded) loadTypes() }, [real])
  return { all: s.types, visible: visibleTypes(s.types) }
}

// The signed-in agent's pick. save(key) → { key, nextKey, nextFrom } (or throws with the server's words).
export function useMyLeadType(real = false) {
  const s = useSyncExternalStore(subscribe, read, read)
  useEffect(() => { if (real && !store.mine.loaded) loadMine() }, [real])
  const save = useCallback(async key => {
    if (!real) {
      // Sample: a running campaign is assumed, so a switch waits for tomorrow like the real one.
      const cur = store.sampleMine
      const tomorrow = new Date(Date.parse(`${centralToday()}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
      store.sampleMine = key === cur.key ? { ...cur, nextKey: null, nextFrom: null } : { ...cur, nextKey: key, nextFrom: tomorrow }
      emit()
      return store.sampleMine
    }
    const db = await sb()
    const { data, error } = await db.rpc('coverage_type_set', { p_types: [key] })
    if (error) throw new Error(error.message || 'Couldn’t save your lead type')
    store.mine = fromRow(data, store.mine.uid)
    emit()
    return store.mine
  }, [real])
  return { ...(real ? s.mine : s.sampleMine), save }
}

// The sign-up saved a pick (signupDetails.saveSignupDetails): Settings shows it without a reload.
export function noteLeadTypePick(data) {
  if (data) { store.mine = fromRow(data, store.mine.uid); emit() }
}

// Admin edits. Sample mode changes the in-memory list only.
export function useLeadTypeAdmin(real = false) {
  const run = async (fn, args, sample) => {
    if (!real) { store.types = byOrder(sample(store.types.map(t => ({ ...t })))); emit(); return }
    const db = await sb()
    const { error } = await db.rpc(fn, args)
    if (error) throw new Error(error.message || 'Couldn’t save')
    await loadTypes(true)
  }
  return {
    save: t => run('admin_coverage_type_save', { p_key: t.key, p_label: t.label, p_words: t.words, p_blurb: t.blurb || '', p_hidden: !!t.hidden },
      list => {
        const i = list.findIndex(x => x.key === t.key)
        if (i >= 0) {
          if (t.hidden && list[i].most_popular) throw new Error('Move "Most popular" to another type before hiding this one')
          list[i] = { ...list[i], ...t, words: t.words.toLowerCase() }
        } else list.push({ ...t, words: t.words.toLowerCase(), sort: Math.max(0, ...list.map(x => x.sort || 0)) + 1, most_popular: false })
        return list
      }),
    order: keys => run('admin_coverage_type_order', { p_keys: keys }, list => list.map(t => ({ ...t, sort: keys.indexOf(t.key) + 1 || 100 + (t.sort || 0) }))),
    popular: key => run('admin_coverage_type_popular', { p_key: key }, list => list.map(t => ({ ...t, most_popular: t.key === key }))),
  }
}
