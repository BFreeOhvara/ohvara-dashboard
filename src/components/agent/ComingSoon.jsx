import { Clock } from 'lucide-react'

// Placeholder for pages that stay in the nav but aren't real yet (Round 33).
// Vertically centered and large, per Round 37 — and deliberately no "before
// launch" in the copy (Round 37 item 4): these ship alongside launch, they
// just aren't wired to anything.
export function ComingSoon({ title, description }) {
  return (
    <div
      className="page-enter"
      style={{
        minHeight: 'calc(100vh - 140px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '24px 16px',
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 10,
        background: 'var(--accent-dim)',
        border: '0.5px solid var(--accent-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 20,
      }}>
        <Clock size={26} style={{ color: 'var(--accent)' }} />
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
        {title}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 10, maxWidth: 420, lineHeight: 1.6 }}>
        {description}
      </p>
      <span style={{
        marginTop: 20, fontSize: 11, fontWeight: 500, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--text-secondary)',
        padding: '5px 10px', borderRadius: 4,
        background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
      }}>
        Coming soon
      </span>
    </div>
  )
}
