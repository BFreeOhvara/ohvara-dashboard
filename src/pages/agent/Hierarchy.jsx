import { useState } from 'react'
import { Copy, Check, Link2, Trash2, ChevronUp } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useHierarchy } from '../../hooks/useHierarchy'
import { usePendingInvites, useCreateInvite, useRevokeInvite } from '../../hooks/useProfiles'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'

// Hierarchy — how the team actually grows (Round 31 / North Star
// "Enrollment/visibility mechanics").
//
// A closer sees ONLY their own chain: their upline above them, their downline
// below them — never siblings, never other branches. Admin gets the full
// company-wide tree. Growth happens through invite links: whoever accepts a
// link becomes that person's direct recruit (claim-invite stamps upline_id
// from the invite's created_by).
export default function Hierarchy() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { self, upline, downline, roots, isLoading } = useHierarchy(profile?.id, isAdmin)

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
          Hierarchy
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          {isAdmin
            ? 'Every agent across the company.'
            : 'Your upline and everyone you’ve recruited.'}
        </p>
      </div>

      <InvitePanel />

      {isLoading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading hierarchy…</p>
      ) : isAdmin ? (
        <div className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {roots.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No agents yet.</p>
          ) : roots.map(root => (
            <div key={root.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <AgentRow agent={root} depth={0} />
              {root.tree.map(a => <AgentRow key={a.id} agent={a} depth={a.depth} />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Upline, furthest first, so the chain reads top-down into "you". */}
          {[...upline].reverse().map((a, i) => (
            <AgentRow key={a.id} agent={a} depth={i} muted label="Upline" />
          ))}
          {upline.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <ChevronUp size={14} />
            </div>
          )}
          {self && <AgentRow agent={self} depth={upline.length} highlight label="You" />}
          {downline.map(a => (
            <AgentRow key={a.id} agent={a} depth={upline.length + 1 + a.depth} />
          ))}
          {downline.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0', paddingLeft: 4 }}>
              You haven’t recruited anyone yet. Share an invite link above to add someone to your downline.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function AgentRow({ agent, depth = 0, muted, highlight, label }) {
  const initials = (agent.full_name || '?')
    .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      marginLeft: Math.min(depth, 6) * 18,
      padding: '12px 14px', borderRadius: 8,
      background: highlight ? 'var(--accent-dim)' : 'var(--bg-base)',
      border: `0.5px solid ${highlight ? 'var(--accent-border)' : 'var(--border)'}`,
      opacity: muted ? 0.75 : 1,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-secondary)' }}>{initials}</span>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
          {agent.full_name}
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
          {agent.username || agent.email}
        </p>
      </div>
      {label && (
        <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {label}
        </span>
      )}
      <Badge label={agent.role} text={agent.role === 'closer' ? 'Agent' : 'Admin'} />
      {!agent.is_active && <Badge label="inactive" />}
    </div>
  )
}

// Invite links. RLS (migration 072) lets any agent mint a 'closer' invite and
// see/revoke only their own; role escalation stays admin-only.
function InvitePanel() {
  const { profile } = useAuth()
  const { data: invites = [] } = usePendingInvites()
  const create = useCreateInvite()
  const revoke = useRevokeInvite()
  const [copied, setCopied] = useState(null)

  // No client-side scoping needed — rep_invites' RLS SELECT policy already
  // returns only the viewer's own links (admin sees all).
  const mine = invites

  function linkFor(token) {
    return `${window.location.origin}/join/${token}`
  }

  async function copy(token) {
    try {
      await navigator.clipboard.writeText(linkFor(token))
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard can be blocked (insecure context, permission denied) — the
      // link is visible on screen either way, so this just doesn't confirm.
    }
  }

  return (
    <div className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Invite an agent</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Whoever accepts your link joins as your direct recruit. Links are single-use and expire after 7 days.
          </p>
        </div>
        <Button
          size="md"
          disabled={create.isPending}
          onClick={() => create.mutate({ role: 'closer', createdBy: profile.id })}
        >
          <Link2 size={14} /> {create.isPending ? 'Generating…' : 'Generate invite link'}
        </Button>
      </div>

      {mine.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mine.map(inv => (
            <div key={inv.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '10px 12px', borderRadius: 8,
              background: 'var(--bg-base)', border: '0.5px solid var(--border)',
            }}>
              <code style={{
                flex: '1 1 220px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 11,
                color: 'var(--text-secondary)',
              }}>
                {linkFor(inv.token)}
              </code>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                expires {new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <Button size="sm" variant="secondary" onClick={() => copy(inv.token)}>
                {copied === inv.token ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(inv.id)} title="Revoke link">
                <Trash2 size={12} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
