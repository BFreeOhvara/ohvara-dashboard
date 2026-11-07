import { useCallback, useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useCheckRow } from '../../hooks/useLiveTransfer'
import { callTransfer, testState } from '../../lib/liveTransfer'
import { SettingsCard, SettingsChip } from '../agent/AgentUI'

// P880 — Setup's push test (N-H-15/16/17). Live calls reach an agent only through the Ohvara phone app, so before
// any come to them: a test Check agent push goes to every phone they're signed in on, they tap Yes, then a test
// call rings their mobile and they press 1. Until both pass (and while the daily check finds no working phone)
// they're booking only: leads still get booked on their calendar. A failure shows what to fix, step by step.
export function PushTestCard() {
  const { session } = useAuth()
  const me = session?.user?.id
  const [reach, setReach] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const [checkId, setCheckId] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [row] = useCheckRow(checkId, { asAgent: true })

  const load = useCallback(() => callTransfer(supabase, 'reach').then(r => { setReach(r?.reach ?? null); setReadiness(r?.readiness ?? null) }).catch(() => {}), [])
  useEffect(() => { if (me) load() }, [me, load])
  // A test finished (answered, called, missed): read the result.
  const done = row && !['sent', 'seen', 'yes', 'ringing'].includes(row.status)
  useEffect(() => { if (done) { load(); const t = setTimeout(() => setCheckId(null), 1500); return () => clearTimeout(t) } return undefined }, [done, load])

  async function run() {
    setErr(null); setBusy(true)
    try {
      const r = await callTransfer(supabase, 'test_push')
      if (r?.check && r.ok) setCheckId(r.check.id)
      else { await load(); if (r?.code === 'no_device') setReadiness(x => ({ ...x, fail_reason: 'no_device' })) }
    } catch (e) { setErr(e.code === 'busy' ? 'A test is already running.' : e.message) } finally { setBusy(false) }
  }

  const st = testState({ reach, readiness, running: row && !done ? row : null })
  return (
    <SettingsCard icon={BellRing} title="Phone app push test"
      sub="Live calls come to you as a push on the Ohvara app: Yes or No in 30 seconds, then your phone rings and you press 1."
      right={<SettingsChip tone={st.tone === 'on' ? 'on' : 'off'}>{st.label}</SettingsChip>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 16, borderTop: '1px solid var(--ov-line)' }}>
        {st.words && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-mute)' }} aria-live="polite">{st.words}</p>}
        {st.fix && (
          <div role="note">
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)' }}>{st.fix.title}</p>
            <ol style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 13.5, color: 'var(--ov-mute)', display: 'grid', gap: 4 }}>
              {st.fix.steps.map(s => <li key={s}>{s}</li>)}
            </ol>
          </div>
        )}
        {err && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--danger)' }}>{err}</p>}
        <div>
          <button type="button" className="ov-primary" disabled={busy || (row && !done)} onClick={run}>
            {reach?.ready ? 'Run the test again' : 'Send a test push'}
          </button>
        </div>
      </div>
    </SettingsCard>
  )
}
