import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { PhoneIncoming } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useCheckRow } from '../../hooks/useLiveTransfer'
import { agentView, answerWords, callTransfer } from '../../lib/liveTransfer'
import { playRing, audioContext } from '../../lib/transferAlert'
import { TRANSFER_EVENT, takePendingTransfer } from '../../lib/push'

// P880 — the agent's live-transfer alert (replaces P182's 4-second poll and the old Accept / Can't take it, which
// only acknowledged a call help-transfer was already dialing). A VA's Check agent makes a transfer_checks row; it
// reaches this screen three ways: realtime (the portal is open), the push's link (/agent?check=…), or a Yes / No
// tapped on the lock screen (lib/push.js fires TRANSFER_EVENT with the answer, which is sent at once).
//   ask        name, age, state, need ("Your client" when it is), Yes / No, the 30 s timer from the server
//   yes        "your phone rings next: press 1", and Can't take it after all (withdraw, before it connects)
//   connected  the lead's card opens (with the VA's notes)
//   over       one closing line: missed, booked for [time], no longer available...
// Mounted once per screen (DashboardLayout, PhoneShell). Portaled to <body> (.page-enter's transform traps fixed).
export function TransferAlert() {
  const { session } = useAuth()
  const me = session?.user?.id
  const navigate = useNavigate()
  // A cold launch from a push may have left one waiting (lib/push.js); else the push's /agent?check=… link.
  const [first] = useState(() => takePendingTransfer())
  const [id, setId] = useState(() => {
    if (first?.check) return first.check
    try { return new URLSearchParams(window.location.search).get('check') } catch { return null }
  })
  const [row, skew, take] = useCheckRow(id, { asAgent: true })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const btn = useRef(null)
  const opened = useRef(null)

  // New checks for me while the portal is open.
  useEffect(() => {
    if (!me) return undefined
    const ch = supabase.channel(`transfer-checks-${me}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transfer_checks', filter: `agent_id=eq.${me}` }, p => {
        if (p.new?.id) { setMsg(null); setId(p.new.id) }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [me])

  // A push opened the app, with or without a Yes / No already tapped (a cold launch left it pending).
  useEffect(() => {
    if (first?.check && first.answer) send(first.check, first.answer)
    const on = e => {
      takePendingTransfer()
      const { check, answer } = e.detail || {}
      if (!check) return
      setMsg(null); setId(check)
      if (answer) send(check, answer)
    }
    window.addEventListener(TRANSFER_EVENT, on)
    return () => window.removeEventListener(TRANSFER_EVENT, on)
  }, [])

  const v = row ? agentView(row, skew, now) : null
  const asking = v?.mode === 'ask'
  useEffect(() => {
    if (!row || v?.mode === 'over') return undefined
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [row, v?.mode])
  // Opening it counts as seen; ring the portal while it asks.
  useEffect(() => {
    if (!asking || !row) return undefined
    if (row.status === 'sent') callTransfer(supabase, 'seen', { check_id: row.id }).then(take).catch(() => {})
    btn.current?.focus()
    const stop = playRing?.()
    const unlock = () => audioContext?.()
    document.addEventListener('pointerdown', unlock, { once: true })
    return () => { document.removeEventListener('pointerdown', unlock); if (typeof stop === 'function') stop() }
  }, [asking, row?.id])
  // Connected: open the lead's card once.
  useEffect(() => {
    if (v?.mode === 'connected' && row?.lead_id && !row.is_test && opened.current !== row.id) {
      opened.current = row.id
      navigate(`/agent/inbounds/${row.lead_id}`)
    }
  }, [v?.mode, row?.id])
  // A closed check stays up a few seconds, then goes.
  useEffect(() => {
    if (v?.mode !== 'over' && v?.mode !== 'connected') return undefined
    const t = setTimeout(() => setId(null), 6000)
    return () => clearTimeout(t)
  }, [v?.mode, row?.id])

  async function send(check, answer) {
    setBusy(true)
    try { const res = take(await callTransfer(supabase, 'answer', { check_id: check, answer })); setMsg(answerWords(res)) } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  async function withdraw() {
    setBusy(true)
    try { take(await callTransfer(supabase, 'withdraw', { check_id: row.id })) } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  if (!id || !row || !v) return null
  return createPortal(
    <>
      <div className="ov-scrim pv-ta-scrim" aria-hidden="true" />
      <section className="ov-hero pv-ta" role="alertdialog" aria-modal="true" aria-labelledby="pv-ta-title" aria-describedby="pv-ta-text">
        <div className="pv-ta-top">
          <span className="pv-ta-ring" aria-hidden="true"><PhoneIncoming size={22} strokeWidth={2} /></span>
          <span className="pv-hero-label"><i className="pv-dot" />{v.test ? 'Test live call' : v.yourClient ? 'Your client · Live call' : 'Live call'}</span>
          {v.left != null && <span className="pv-ta-left" aria-label={`${v.left} seconds left`}>{v.left}s</span>}
        </div>
        <h2 id="pv-ta-title">{row.summary?.name || 'A lead'}</h2>
        {v.line && <p className="pv-ta-line">{v.line}</p>}
        <p id="pv-ta-text">{msg || v.words}</p>
        <div className="pv-ta-btns">
          {asking && <>
            <button ref={btn} type="button" className="ov-hero-btn pv-ta-btn" disabled={busy} onClick={() => send(row.id, 'yes')}>Yes, I&rsquo;ll take it</button>
            <button type="button" className="pv-ta-btn pv-ta-decline" disabled={busy} onClick={() => send(row.id, 'no')}>No</button>
          </>}
          {v.mode === 'yes' && <button type="button" className="pv-ta-btn pv-ta-decline" disabled={busy} onClick={withdraw}>Can&rsquo;t take it after all</button>}
          {(v.mode === 'over' || v.mode === 'connected') && <button type="button" className="pv-ta-btn pv-ta-decline" onClick={() => setId(null)}>Close</button>}
        </div>
      </section>
    </>,
    document.body,
  )
}
