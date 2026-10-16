import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Landmark, Loader2, Pause, Play, RefreshCw, X } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import { Switch } from '../ui/Switch'
import { money, dayLong, monDay, clock } from '../../lib/adminPayouts'

// Prompt 765 — Admin Payouts, simple version. Copied from
// media/admin-redesign/admin-payouts-simple.dc.html: the next pay run (it pays
// by itself, so there is no Approve or Pay button anywhere), one row per rep,
// past pay runs; and on the right the cancels that need a listen plus the
// payout settings. Pure view: the page (pages/admin/Payouts.jsx) wires the
// data, the harness wires fakes.

const LazyEmbed = lazy(() => import('../fulfillment/ConnectEmbeds'))

const STATE = {
  ready: ['Bank ready', 'is-ok'],
  nobank: ['No bank yet', 'is-warn'],
  held: ['Held', 'is-warn'],
}

function Next({ model }) {
  const { mode, nextRun } = model
  const badge = {
    auto: { cls: 'is-auto', label: 'Pays automatically', note: 'Monday 8 AM · nothing for you to do', icon: <RefreshCw size={16} strokeWidth={2.2} aria-hidden="true" /> },
    paused: { cls: 'is-off', label: 'Paused', note: 'Automatic payouts are paused. Nobody is paid until you turn them back on.', icon: <Pause size={16} strokeWidth={2.2} aria-hidden="true" /> },
    off: { cls: 'is-off', label: 'Not live yet', note: 'Payouts are off, so the Monday run moves no money.', icon: <Pause size={16} strokeWidth={2.2} aria-hidden="true" /> },
  }[mode]
  return (
    <div className="ap2-next-head">
      <div className="ap2-next-main">
        <span className="ap2-when"><i />Next pay run · {monDay(nextRun.date)}</span>
        <div className="ap2-amt"><b>{money(nextRun.cents)}</b><span>so far · {nextRun.count} verified cancel{nextRun.count === 1 ? '' : 's'}</span></div>
      </div>
      <div className="ap2-badge-wrap">
        <span className={`ap2-badge ${badge.cls}`}>{badge.icon}{badge.label}</span>
        <div className="ap2-badge-note">{badge.note}</div>
      </div>
    </div>
  )
}

function RepRow({ r, rep }) {
  const [label, tone] = STATE[r.state]
  const n = `${r.count} cancel${r.count === 1 ? '' : 's'}`
  const sub = r.state === 'nobank' ? `${n} · held until they connect a bank`
    : r.state === 'held' ? `${n} · ${r.over} over the weekly cap`
      : `${n} · to ${r.bank}`
  return (
    <div className="ap2-rep">
      {rep ? <Avatar profile={rep} size={40} /> : <span className="ap2-av-none">?</span>}
      <span className="ap2-rep-who"><b>{rep?.full_name || 'Unknown'}</b><span>{sub}</span></span>
      <span className={`ap2-pill ${tone}`}><i />{label}</span>
      <span className="ap2-rep-pay">{money(r.cents)}</span>
    </div>
  )
}

// Same bars on every card, taken from the cancel's id so they don't shuffle.
function bars(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return Array.from({ length: 30 }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.7 + (h % 7)) * 14 + Math.sin(i * 0.6 + (h % 5)) * 6)))
}

let playing = null // one recording at a time
function ListenPlayer({ c, loadAudio }) {
  const rec = c.recording
  const dur = rec?.duration_seconds || 0
  const start = Number(c.listen_at_seconds) || 0
  const [phase, setPhase] = useState('idle') // idle · loading · ready · error
  const [on, setOn] = useState(false)
  const [at, setAt] = useState(start)
  const [len, setLen] = useState(dur) // the audio's own length once it's loaded
  const [err, setErr] = useState('')
  const audio = useRef(null)
  const url = useRef(null)
  const heights = useMemo(() => bars(c.id), [c.id])
  const hasAudio = !!(c.recording_id && rec?.status === 'ready')

  useEffect(() => () => {
    audio.current?.pause()
    if (playing === audio.current) playing = null
    if (url.current) URL.revokeObjectURL(url.current)
  }, [])

  async function toggle() {
    if (on) { audio.current.pause(); return }
    let a = audio.current
    if (!a) {
      setPhase('loading'); setErr('')
      try {
        url.current = await loadAudio(c.recording_id)
      } catch (e) { setErr(e.message); setPhase('error'); return }
      a = new Audio(url.current)
      a.addEventListener('timeupdate', () => setAt(a.currentTime))
      a.addEventListener('play', () => setOn(true))
      a.addEventListener('pause', () => setOn(false))
      a.addEventListener('ended', () => setOn(false))
      // Start where the AI thinks the carrier says it.
      a.addEventListener('loadedmetadata', () => { setLen(a.duration || dur); if (start && start < (a.duration || Infinity)) a.currentTime = start }, { once: true })
      audio.current = a
      setPhase('ready')
    }
    if (playing && playing !== a) playing.pause()
    playing = a
    a.play().catch(e => setErr(e.message))
  }

  const total = len
  const done = total ? Math.min(1, at / total) : 0
  return (
    <div className="ap2-player">
      <button type="button" className="ap2-play" onClick={toggle} disabled={!hasAudio || phase === 'loading'}
        aria-label={on ? 'Pause the recording' : 'Play the recording'} title={hasAudio ? undefined : 'No recording to play'}>
        {phase === 'loading' ? <Loader2 size={13} className="animate-spin" /> : on ? <Pause size={12} fill="currentColor" strokeWidth={0} /> : <Play size={12} fill="currentColor" strokeWidth={0} />}
      </button>
      <span className="ap2-wave" aria-hidden="true">
        {heights.map((h, i) => <span key={i} className={i / heights.length < done ? 'is-on' : ''} style={{ height: h }} />)}
      </span>
      <span className="ap2-clock">{hasAudio ? (on || at !== start ? `${clock(at)} / ${clock(total)}` : clock(total)) : '—'}</span>
      {err && <span role="alert" className="ap2-err ap2-player-err">{err}</span>}
    </div>
  )
}

const stamp = (iso, tz) => {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
  return `${day} ${time}`
}

function ListenCard({ c, rep, tz, loadAudio, onDecide, deciding }) {
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')
  const busy = deciding === c.id
  async function go(pay) {
    if (!pay && note.trim().length < 3) { setNoting(true); setHint('Say why it isn’t paid'); return }
    setHint(''); setError('')
    try { await onDecide({ id: c.id, pay, note }) } catch (e) { setError(e.message) }
  }
  return (
    <div className="ap2-lcard">
      <div className="ap2-lcard-top"><b>{c.client_name || 'Client'}</b><span>{money(c.amount_cents)}</span></div>
      <div className="ap2-lcard-sub">{[c.carrier_name, rep?.full_name || c.agent_name, stamp(c.logged_at, tz)].filter(Boolean).join(' · ')}</div>
      <div className="ap2-lcard-why">{c.reasonText}</div>
      <ListenPlayer c={c} loadAudio={loadAudio} />
      {noting ? (
        <input className="ap2-note" value={note} onChange={e => { setNote(e.target.value); setHint('') }} placeholder="Note (needed for Don’t pay)"
          aria-label="Note" maxLength={300} autoFocus />
      ) : (
        <button type="button" className="ap2-addnote" onClick={() => setNoting(true)}>Add a note</button>
      )}
      {hint && <span role="alert" className="ap2-err">{hint}</span>}
      {error && <span role="alert" className="ap2-err">{error}</span>}
      <div className="ap2-btns">
        <button type="button" className="ap2-solid" disabled={busy} onClick={() => go(true)}>Pay it</button>
        <button type="button" className="ap2-ghost" disabled={busy} onClick={() => go(false)}>Don’t pay</button>
      </div>
    </div>
  )
}

function BankModal({ account, hasAccount, Embed, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // Portaled to <body>: a fixed modal under DashboardLayout's animated wrapper
  // would be positioned against the page, not the screen (see Gotchas).
  return createPortal(
    <div className="ap2-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ov-card ap2-modal" role="dialog" aria-modal="true" aria-label="Your bank">
        <div className="ap2-modal-head">
          <div>
            <h2>{account ? 'Change your bank' : 'Connect your bank'}</h2>
            <p>Stripe’s own secure form. Bank numbers go straight to Stripe, never through Ohvara.</p>
          </div>
          <button type="button" className="ap2-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <Suspense fallback={<div className="ap2-wait">Loading…</div>}>
          <Embed kind={hasAccount ? 'bank' : 'onboarding'} onDone={onClose} />
        </Suspense>
      </div>
    </div>,
    document.body,
  )
}

export function PayoutsView({
  model, profiles, tz, rate, loading, error, listenError,
  balance, balanceLoading, bank, hasBankAccount, autoOn, savingAuto, onToggleAuto,
  onDecide, deciding, loadAudio, onBankClosed, Embed = LazyEmbed,
}) {
  const [bankOpen, setBankOpen] = useState(false)
  const { reps, past, listen, nextRun, mode } = model
  const covers = balance == null ? null : balance >= nextRun.cents
  const closeBank = () => { setBankOpen(false); onBankClosed?.() }

  return (
    <div className="ap2-page">
      <div className="ap2-col">
        <section className="ap2-next" aria-label="Next pay run">
          <Next model={model} />
          <div className="ap2-reps">
            {loading && <div className="ap2-empty">Loading…</div>}
            {!loading && error && <div className="ap2-empty is-err">Couldn’t load pay: {error}</div>}
            {!loading && !error && !reps.length && <div className="ap2-empty">No verified cancels waiting for Monday.</div>}
            {reps.map(r => <RepRow key={r.repId} r={r} rep={profiles.get(r.repId)} />)}
          </div>
        </section>

        <section className="ov-card ap2-runs" aria-label="Past pay runs">
          <div className="ap2-sec-head">
            <h2>Past pay runs</h2>
            {model.paidSince && <span>{money(model.paidTotal)} paid since {dayLong(model.paidSince)}</span>}
          </div>
          <div className="ap2-runs-list">
            {!past.length && <div className="ap2-empty">No pay runs yet.</div>}
            {past.map(r => (
              <div key={r.id} className="ap2-run">
                <span className="ap2-run-day">{r.day}</span>
                <span className="ap2-run-sub">{r.sub}</span>
                <span className="ap2-run-amt">{money(r.cents)}</span>
                <span className="ap2-run-paid">Paid</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="ap2-col">
        <section className="ov-card ap2-listen" aria-label="Needs a listen">
          <div className="ap2-listen-head"><h2>Needs a listen</h2><span className="ap2-count">{listen.length}</span></div>
          <p>AI couldn’t tell the carrier confirmed it. Listen, then decide.</p>
          {listenError && <div className="ap2-empty is-err">Couldn’t load them: {listenError}</div>}
          {!listenError && !listen.length && <div className="ap2-nothing">Nothing to listen to</div>}
          <div className="ap2-lcards">
            {listen.map(c => <ListenCard key={c.id} c={c} rep={profiles.get(c.rep_id)} tz={tz} loadAudio={loadAudio} onDecide={onDecide} deciding={deciding} />)}
          </div>
        </section>

        <section className="ov-card ap2-settings" aria-label="Payout settings">
          <div className="ap2-sec-head"><h2>Payout settings</h2><span>Stripe</span></div>
          <div className="ap2-bank">
            <span className="ap2-bank-ico"><Landmark size={20} strokeWidth={1.9} aria-hidden="true" /></span>
            <span className="ap2-bank-who">
              <span>Your bank</span>
              <b>{bank || 'No bank yet'}</b>
            </span>
            <button type="button" className="ap2-link" onClick={() => setBankOpen(true)}>{bank ? 'Change' : 'Connect'}</button>
          </div>
          <div className="ap2-set">
            <div className="ap2-set-row">
              <span><b>Stripe balance</b>
                <span>{balanceLoading ? 'Checking…' : covers == null ? 'Balance unavailable' : covers ? 'Covers Monday’s run' : 'Not enough for Monday'}</span></span>
              <span className={`ap2-set-v${covers === false ? ' is-bad' : ''}`}>{balance == null ? '—' : money(balance)}</span>
            </div>
            <div className="ap2-set-row">
              <span><b>Pay per cancel</b><span><Link to="/settings#pay">Change in Settings</Link> · applies to new cancels</span></span>
              <span className="ap2-set-v is-mono">{money(rate)}</span>
            </div>
            <div className="ap2-set-row">
              <span><b>Automatic payouts</b>
                <span>{mode === 'off' ? 'Not live yet · turn on in Settings' : autoOn ? 'Every Monday · tap to pause' : 'Paused · tap to resume'}</span></span>
              <span className="ap2-set-sw">
                <b className={autoOn ? 'is-on' : ''}>{autoOn ? 'On' : 'Off'}</b>
                <Switch checked={autoOn} disabled={savingAuto} onChange={onToggleAuto} />
              </span>
            </div>
          </div>
        </section>
      </div>
      {bankOpen && <BankModal account={bank} hasAccount={hasBankAccount} Embed={Embed} onClose={closeBank} />}
    </div>
  )
}
