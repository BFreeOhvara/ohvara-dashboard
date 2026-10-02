import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { TRAINING_MODULES, TOTAL_MODULES } from '../data/agentTraining'

// Agent Training tab (Prompt 670). One training_progress row per user
// (migration 020, reused); modules_completed (migration 110) holds the ids of
// the modules they've marked done. RLS: tp_rep_own lets a user read/write
// their own row, tp_admin_select lets admin read everyone's.

const KNOWN = new Set(TRAINING_MODULES.map(m => m.id))

// Only ids that still exist count — a module removed from agentTraining.js
// can't leave someone stuck at "5 of 4".
export function completedIds(row) {
  return (row?.modules_completed || []).filter(id => KNOWN.has(id))
}

export function useMyTraining(userId) {
  return useQuery({
    queryKey: ['training', 'mine', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_progress')
        .select('rep_id, modules_completed, unlocked_at, updated_at')
        .eq('rep_id', userId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

// Tick or untick one module. unlocked_at is stamped the first time every
// module is done and kept after that, so it reads as "first finished on".
export function useSetModuleDone(userId) {
  const qc = useQueryClient()
  const key = ['training', 'mine', userId]
  return useMutation({
    mutationFn: async ({ moduleId, done, current }) => {
      const now = new Date().toISOString()
      const set = new Set(completedIds(current))
      if (done) set.add(moduleId); else set.delete(moduleId)
      const modules_completed = TRAINING_MODULES.map(m => m.id).filter(id => set.has(id))
      const row = { rep_id: userId, modules_completed, updated_at: now }
      if (modules_completed.length === TOTAL_MODULES && !current?.unlocked_at) row.unlocked_at = now
      const { data, error } = await supabase
        .from('training_progress')
        .upsert(row, { onConflict: 'rep_id' })
        .select('rep_id, modules_completed, unlocked_at, updated_at')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: data => {
      qc.setQueryData(key, data)
      qc.invalidateQueries({ queryKey: ['training', 'team'] })
    },
  })
}

// Admin: every active agent with their progress (no row = not started).
export function useTeamTraining(enabled) {
  return useQuery({
    queryKey: ['training', 'team'],
    enabled,
    queryFn: async () => {
      const [{ data: agents, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('role', 'agent').eq('is_active', true).order('full_name'),
        supabase.from('training_progress').select('rep_id, modules_completed, unlocked_at, updated_at'),
      ])
      if (e1) throw e1
      if (e2) throw e2
      const byId = new Map((rows || []).map(r => [r.rep_id, r]))
      return (agents || []).map(a => ({ ...a, progress: byId.get(a.id) || null }))
    },
  })
}
