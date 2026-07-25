import { ExternalLink } from 'lucide-react'
import { ghostBtn } from '../../lib/exportStyles'

// Real quoter, Prompt 328 — InsuranceToolkits.com embedded in place of the
// old ComingSoon placeholder. Brayden's own account (app.insurancetoolkits.com,
// FEX Quoter), not a generic public/token link — no anonymous "Lite Link"
// exists for FEX/SIUL/Term without an owned account, per InsuranceToolkits'
// own docs. First visit inside the iframe will show InsuranceToolkits'
// login screen; the browser remembers the session after that, same as any
// other embedded third-party tool. "Open in new tab" is kept alongside the
// iframe for whenever the embed itself misbehaves (frame-busting, popups).
const QUOTER_URL = 'https://app.insurancetoolkits.com/fex/quoter'

export default function Quoter() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <a
          href={QUOTER_URL}
          target="_blank"
          rel="noreferrer"
          style={{ ...ghostBtn, textDecoration: 'none' }}
        >
          Open in new tab <ExternalLink size={12} />
        </a>
      </div>
      <div style={{
        flex: 1, minHeight: 0,
        background: 'var(--bg-surface)',
        border: 'var(--border-w) solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <iframe
          src={QUOTER_URL}
          title="InsuranceToolkits Quoter"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    </div>
  )
}
