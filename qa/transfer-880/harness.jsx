/* eslint-disable react-refresh/only-export-components -- QA harness entry, not app code */
// P880 QA harness (dev server only, never shipped): the REAL agent alert (components/agent/TransferAlert) and the
// REAL Setup push test card, with help-transfer answered by shots.mjs (Playwright route) from fixtures. The
// lock-screen alert is a drawn MOCK built from the real push text (notify-push/transfer.ts checkPush); a real
// lock screen needs a phone with the new native build.
//   /qa/transfer-880/harness.html?view=alert&check=<id>   the in-app alert for that fixture
//   /qa/transfer-880/harness.html?view=lock               the lock-screen mock
//   /qa/transfer-880/harness.html?view=setup              the Setup push test card
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../src/hooks/useTheme'
import '../../src/index.css'
import '../../src/pages/agent/v2/portalV2.css'
import { AuthProvider } from '../../src/hooks/useAuth'
import { TransferAlert } from '../../src/components/agent/TransferAlert'
import { PushTestCard } from '../../src/components/settings/PushTestCard'
import { checkPush } from '../../supabase/functions/notify-push/transfer.ts'

const q = new URLSearchParams(location.search)
const view = q.get('view') || 'alert'

function Lock() {
  const m = checkPush({ id: 'c-mock', summary: { name: 'Rosa Diaz', age: 64, state: 'TX', need: 'Final expense', your_client: false } }, '')
  const card = { background: 'color-mix(in srgb, var(--ov-hi) 12%, transparent)', backdropFilter: 'blur(18px)', borderRadius: 22, padding: '14px 16px', color: 'var(--ov-hi)' }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'start center', paddingTop: 70, background: 'var(--ov-bg)' }}>
      <div style={{ width: 'min(380px, calc(100vw - 32px))', display: 'grid', gap: 10 }}>
        <p style={{ textAlign: 'center', color: 'var(--ov-mute)', fontSize: 12, margin: 0 }}>Mock of the lock-screen alert (real text from checkPush)</p>
        <p style={{ textAlign: 'center', fontSize: 64, fontWeight: 600, margin: '0 0 18px', color: 'var(--ov-hi)', fontFamily: 'var(--font-display)' }}>2:14</p>
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ov-mute)' }}><b>OHVARA PORTAL · TIME SENSITIVE</b><span>now</span></div>
          <p style={{ margin: '6px 0 2px', fontWeight: 700 }}>{m.title}</p>
          <p style={{ margin: 0, fontSize: 14 }}>{m.body}</p>
        </div>
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <p style={{ margin: 0, padding: '12px 16px', borderBottom: '1px solid var(--ov-line)', fontWeight: 600 }}>Yes, I&rsquo;ll take it</p>
          <p style={{ margin: 0, padding: '12px 16px', fontWeight: 600 }}>No</p>
        </div>
      </div>
    </div>
  )
}

const qc = new QueryClient()
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={qc}>
    <AuthProvider>
      <MemoryRouter>
        {view === 'lock' && <Lock />}
        {view === 'alert' && <div style={{ minHeight: '100vh', background: 'var(--ov-bg)' }}><TransferAlert /></div>}
        {view === 'setup' && <div style={{ minHeight: '100vh', background: 'var(--ov-bg)', padding: 16 }}><div style={{ maxWidth: 720, margin: '0 auto' }}><PushTestCard /></div></div>}
      </MemoryRouter>
    </AuthProvider>
  </QueryClientProvider>,
)
