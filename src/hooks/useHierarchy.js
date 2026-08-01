import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isTestAccount } from '../lib/testAccounts'

// Agent hierarchy behind the Hierarchy page (Round 31, migration 072).
//
// Visibility is strictly scoped for a closer: their own upline chain and
// their own downline subtree, never siblings or other branches. Admin gets
// the full company-wide tree.
//
// KNOWN GAP, deliberate: profiles' RLS SELECT policy is `auth.uid() is not
// null` (migration 010, widened so closers could read rep names on the old
// setter pages), so this scoping is enforced in the query below rather than
// at the row level. Tightening that policy would need every legacy page that
// joins profiles re-checked first — out of scope for this prompt, flagged.

// Full profile set, then walked into a tree client-side. Three agents at
// launch — a recursive server call per view would cost more than it saves.
//
// Test accounts (Prompt 371) are dropped from this shared list entirely, so
// they never appear in admin's company-wide tree/member count. A test
// account viewing its OWN Hierarchy page still works — Hierarchy.jsx already
// falls back to the signed-in profile when `self` isn't found in this list.
function useAgents() {
  return useQuery({
    queryKey: ['profiles', 'hierarchy'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, username, role, upline_id, is_active, created_at, avatar_url, avatar_color')
        .in('role', ['closer', 'admin'])
        .order('created_at')
      if (error) throw error
      return (data || []).filter(a => !isTestAccount(a.id))
    },
  })
}

function buildIndex(agents) {
  const byId = new Map(agents.map(a => [a.id, a]))
  const children = new Map()
  for (const a of agents) {
    if (!a.upline_id) continue
    if (!children.has(a.upline_id)) children.set(a.upline_id, [])
    children.get(a.upline_id).push(a)
  }
  return { byId, children }
}

function subtree(id, index, depth = 0) {
  const kids = index.children.get(id) || []
  return kids.flatMap(k => [{ ...k, depth }, ...subtree(k.id, index, depth + 1)])
}

function ancestors(id, index) {
  const chain = []
  let cur = index.byId.get(id)
  const seen = new Set([id])
  while (cur?.upline_id && !seen.has(cur.upline_id)) {
    seen.add(cur.upline_id)
    const up = index.byId.get(cur.upline_id)
    if (!up) break
    chain.push(up)
    cur = up
  }
  return chain // nearest upline first
}

/**
 * @param profileId  the viewer
 * @param isAdmin    admin sees the whole company; a closer sees only their chain
 * Returns { upline, self, downline, roots, all } — `roots`/`all` are the
 * company-wide shape and are only populated for admin.
 */
export function useHierarchy(profileId, isAdmin = false) {
  const { data: agents = [], isLoading, error } = useAgents()

  const index = buildIndex(agents)
  const self = index.byId.get(profileId) || null

  return {
    isLoading,
    error,
    self,
    upline: self ? ancestors(profileId, index) : [],
    downline: self ? subtree(profileId, index) : [],
    // Admin-only: every top-level agent, each with its own flattened subtree.
    roots: isAdmin
      ? agents.filter(a => !a.upline_id).map(r => ({ ...r, depth: 0, tree: subtree(r.id, index, 1) }))
      : [],
    all: isAdmin ? agents : [],
  }
}
