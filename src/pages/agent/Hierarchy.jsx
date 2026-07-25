import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useHierarchy } from '../../hooks/useHierarchy'
import { usePendingInvites, useCreateInvite, useRevokeInvite } from '../../hooks/useProfiles'
import { MONO, card, ghostBtn } from '../../lib/exportStyles'
import { GapNote } from '../../components/ui/ExportForm'

// Hierarchy — literal port of the export's two Hierarchy screens (vault:
// media/claude-design-export-ohvara-dashboard-v3.html): "Closer · Hierarchy"
// (lines 229-314) and "Admin · Hierarchy" (lines 316-375). A closer sees two
// stat cards, the invite-link panel, and a centred upline → you → downline
// tree; admin sees network/team counts and one expandable card per recruiting
// chain.
//
// Flagged deviations:
//  · The export's "+ Add recruit manually" form isn't ported. Creating an
//    account needs the admin API, and profiles_update_self would block an
//    agent writing someone else's row — the invite link IS the mechanism
//    (claim-invite stamps upline_id from the invite's creator).
//  · Same reason for the per-recruit remove button: detaching someone from a
//    downline rewrites THEIR row. Admin territory, not an agent's.
//  · The export shows a single permanent invite link. Real links are
//    single-use with a 7-day expiry, so the panel lists what's live and can
//    mint another.

const initialsOf = name =>
  (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()

const roleLabel = r => (r === 'admin' ? 'Admin' : 'Closer')

const statCard = { ...card, flex: 1, padding: '18px 22px', minWidth: 220 }
const statLabel = {
  margin: '0 0 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--text-secondary)',
}
const statNote = { margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }

export default function Hierarchy() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { self, upline, downline, all, isLoading } = useHierarchy(profile?.id, isAdmin)

  if (isLoading) {
    return <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading hierarchy…</p>
  }
  return isAdmin
    ? <AdminHierarchy agents={all} />
    // `self` comes from the profiles query; fall back to the signed-in
    // profile so the "you" node still reads correctly if that query is
    // empty for any reason.
    : <CloserHierarchy self={self || profile} upline={upline} downline={downline} />
}

// ── Closer view ─────────────────────────────────────────────────────────────
function CloserHierarchy({ self, upline, downline }) {
  const direct = downline.filter(a => a.depth === 0)
  const boss = upline[0] || null

  // How many people sit under each direct recruit — the export's flat row of
  // cards has nowhere to show depth, and hiding it would misreport the team.
  const below = useMemo(() => {
    const byId = new Map(downline.map(a => [a.id, a]))
    const counts = new Map()
    for (const a of downline) {
      let cur = byId.get(a.upline_id)
      const seen = new Set()
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id)
        counts.set(cur.id, (counts.get(cur.id) || 0) + 1)
        cur = byId.get(cur.upline_id)
      }
    }
    return counts
  }, [downline])

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={statCard}>
          <p style={statLabel}>Direct recruits</p>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', fontFamily: MONO }}>
            {direct.length}
          </div>
          <p style={statNote}>People you've personally recruited</p>
        </div>
        <div style={statCard}>
          <p style={statLabel}>Your upline</p>
          <div style={{ fontSize: 19, fontWeight: 700, color: boss ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {boss ? boss.full_name : '—'}
          </div>
          <p style={statNote}>
            {boss
              ? `${roleLabel(boss.role)} · ${upline.length > 1 ? `${upline.length} levels above you` : 'directly above you'}`
              : "You're at the top of your chain — nobody recruited you"}
          </p>
        </div>
      </div>

      <InvitePanel />

      <div style={{ ...card, padding: '36px 28px 28px' }}>
        {boss && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <PersonChip person={boss} size="sm" />
            </div>
            <Connector />
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
            borderRadius: 8, padding: '14px 22px', minWidth: 250,
          }}>
            <span style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--bg-surface)', border: '1px solid var(--accent-border)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: 'var(--accent)', flexShrink: 0,
            }}>
              {initialsOf(self?.full_name)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                {self?.full_name || '—'}{' '}
                <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--text-muted)' }}>(you)</span>
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                {self ? roleLabel(self.role) : ''}
              </p>
            </div>
          </div>
        </div>

        {direct.length === 0 ? (
          <p style={{ margin: '18px 0 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            You haven't recruited anyone yet — share your invite link above to get started.
          </p>
        ) : (
          <>
            <Connector />
            <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
              {direct.map(n => (
                <PersonChip key={n.id} person={n} below={below.get(n.id) || 0} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Connector() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 1, height: 22, background: 'var(--border-hover)' }} />
    </div>
  )
}

function PersonChip({ person, below = 0, size }) {
  const sm = size === 'sm'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: sm ? 'var(--bg-elevated)' : 'var(--bg-surface)',
      border: 'var(--border-w) solid var(--border)',
      borderRadius: 8, padding: sm ? '11px 18px' : '12px 16px',
      minWidth: sm ? 230 : 250,
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: '50%',
        background: sm ? 'var(--bg-panel)' : 'var(--bg-elevated)',
        border: 'var(--border-w) solid var(--border)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10.5, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0,
      }}>
        {initialsOf(person.full_name)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{person.full_name}</p>
        <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--text-muted)' }}>
          {roleLabel(person.role)}
          {below > 0 && ` · ${below} below them`}
          {person.is_active === false && ' · inactive'}
        </p>
      </div>
    </div>
  )
}

// ── Invite panel ────────────────────────────────────────────────────────────
// RLS (migration 072) lets any agent mint a 'closer' invite and see/revoke
// only their own; role escalation stays admin-only.
function InvitePanel() {
  const { profile } = useAuth()
  const { data: invites = [] } = usePendingInvites()
  const create = useCreateInvite()
  const revoke = useRevokeInvite()
  const [copied, setCopied] = useState(null)

  const linkFor = token => `${window.location.origin}/join/${token}`
  const latest = invites[0] || null

  async function copy(token) {
    try {
      await navigator.clipboard.writeText(linkFor(token))
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard can be blocked (insecure context, denied permission) — the
      // link is on screen either way, this just doesn't confirm.
    }
  }

  return (
    <div style={{ ...card, padding: '20px 24px', marginBottom: 20 }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Grow your downline</p>
      <p style={{ margin: '0 0 14px', fontSize: 11.5, color: 'var(--text-muted)' }}>
        Share your invite link — anyone who joins through it becomes your direct recruit. Links are single-use
        and expire after 7 days.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{
          flex: 1, minWidth: 220, height: 36, display: 'flex', alignItems: 'center', padding: '0 12px',
          background: 'var(--bg-base)', border: 'var(--border-w) solid var(--border)', borderRadius: 6,
          fontSize: 12, color: latest ? 'var(--text-secondary)' : 'var(--text-muted)', fontFamily: MONO,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {latest ? linkFor(latest.token) : 'No live link — generate one'}
        </div>
        {latest && (
          <button
            onClick={() => copy(latest.token)}
            style={{ height: 36, padding: '0 16px', border: 'none', borderRadius: 6, background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            {copied === latest.token ? 'Copied' : 'Copy link'}
          </button>
        )}
        <button
          onClick={() => create.mutate({ role: 'closer', createdBy: profile.id })}
          disabled={create.isPending}
          style={{ ...ghostBtn, height: 36, background: 'transparent', whiteSpace: 'nowrap' }}
        >
          {create.isPending ? 'Generating…' : '+ New invite link'}
        </button>
      </div>

      {invites.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {invites.slice(1).map(inv => (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <code style={{
                flex: '1 1 220px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)',
              }}>
                {linkFor(inv.token)}
              </code>
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                expires {new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <button onClick={() => copy(inv.token)} style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 11, fontWeight: 700, padding: 0 }}>
                {copied === inv.token ? 'Copied' : 'Copy'}
              </button>
              <button onClick={() => revoke.mutate(inv.id)} title="Revoke link" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', padding: 2 }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Admin view ──────────────────────────────────────────────────────────────
function AdminHierarchy({ agents }) {
  const [collapsed, setCollapsed] = useState({})

  const { roots, childrenOf } = useMemo(() => {
    const kids = new Map()
    for (const a of agents) {
      if (!a.upline_id) continue
      if (!kids.has(a.upline_id)) kids.set(a.upline_id, [])
      kids.get(a.upline_id).push(a)
    }
    return {
      roots: agents.filter(a => !a.upline_id),
      childrenOf: id => kids.get(id) || [],
    }
  }, [agents])

  const joined = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—')

  return (
    <div style={{ maxWidth: 1280 }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={statCard}>
          <p style={statLabel}>Total network</p>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', fontFamily: MONO }}>{agents.length}</div>
          <p style={statNote}>People across every team, company-wide</p>
        </div>
        <div style={statCard}>
          <p style={statLabel}>Teams</p>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', fontFamily: MONO }}>{roots.length}</div>
          <p style={statNote}>Independent recruiting chains from the top</p>
        </div>
      </div>

      {roots.length === 0 ? (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            No agents yet — accounts appear here as soon as they're created or an invite is claimed.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {roots.map(root => {
            const open = !collapsed[root.id]
            const children = childrenOf(root.id)
            return (
              <div key={root.id} style={{ ...card, padding: '22px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: children.length && open ? 14 : 0 }}>
                  <span style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: 'var(--accent)', flexShrink: 0,
                  }}>
                    {initialsOf(root.full_name)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{root.full_name}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                      {roleLabel(root.role)} · joined {joined(root.created_at)} · {children.length} direct {children.length === 1 ? 'recruit' : 'recruits'}
                    </p>
                  </div>
                  {children.length > 0 && (
                    <button
                      onClick={() => setCollapsed(c => ({ ...c, [root.id]: open }))}
                      style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', padding: 2 }}
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                </div>

                {open && children.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 24, borderLeft: 'var(--border-w) solid var(--border)' }}>
                    {children.map(n1 => (
                      <Branch key={n1.id} agent={n1} childrenOf={childrenOf} joined={joined} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <GapNote>
        Chains are built from `profiles.upline_id`, which is stamped when someone claims an invite link — an
        account created by hand in Users &amp; Access has no upline and shows as its own team until one is set.
      </GapNote>
    </div>
  )
}

function Branch({ agent, childrenOf, joined }) {
  const [open, setOpen] = useState(true)
  const kids = childrenOf(agent.id)

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
        borderRadius: 7, padding: '10px 14px',
      }}>
        <span style={{
          width: 26, height: 26, borderRadius: '50%',
          background: 'var(--bg-panel)', border: 'var(--border-w) solid var(--border)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0,
        }}>
          {initialsOf(agent.full_name)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{agent.full_name}</p>
          <p style={{ margin: '1px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>
            {roleLabel(agent.role)} · joined {joined(agent.created_at)}
            {kids.length > 0 && ` · ${kids.length} direct`}
          </p>
        </div>
        {kids.length > 0 && (
          <button
            onClick={() => setOpen(v => !v)}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', display: 'inline-flex', padding: 2 }}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
      </div>

      {open && kids.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, paddingLeft: 20, borderLeft: 'var(--border-w) solid var(--border)' }}>
          {kids.map(n2 => (
            <Branch key={n2.id} agent={n2} childrenOf={childrenOf} joined={joined} />
          ))}
        </div>
      )}
    </div>
  )
}
