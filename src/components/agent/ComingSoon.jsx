import { Clock } from 'lucide-react'

// Placeholder for pages that stay in the nav but aren't real yet.
//
// Literal port of the export's coming-soon card (vault:
// media/claude-design-export-ohvara-dashboard-v3.html, lines 1418-1424 and
// 1474-1480): a bordered --bg-surface card, 72px accent circle, 28px heading,
// 16px body, centred in the viewport. The title doubles as the page name the
// header already shows, and the description carries the real reason it's
// empty rather than a generic "coming soon".
export function ComingSoon({ title, description }) {
  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: 'var(--border-w) solid var(--border)',
        borderRadius: 8,
        padding: '100px 56px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        textAlign: 'center', gap: 20, maxWidth: 560,
      }}>
        <span style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Clock size={32} style={{ color: 'var(--accent)' }} />
        </span>
        <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>
          {title}
        </p>
        <p style={{ margin: 0, fontSize: 16, color: 'var(--text-secondary)', maxWidth: 440, lineHeight: 1.7 }}>
          {description}
        </p>
      </div>
    </div>
  )
}
