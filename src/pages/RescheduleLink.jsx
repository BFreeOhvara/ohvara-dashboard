import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, CalendarCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import ohvaraLogo from '../assets/ohvara-logo.png'

// Prompt 696 — the client's self-serve reschedule page (/r/<token>), reached
// from the missed-call text. No login: the token in the URL is the credential
// and the edge function only ever returns a first name and open call times.
// Times are shown in the visitor's own timezone; the slots themselves are
// 9–4 weekdays in the booking agent's zone (decided server-side).

const MONO = 'var(--font-mono, ui-monospace, monospace)'

const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const fmtDay = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
const fmtTime = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const fmtFull = iso => new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })

async function call(body) {
  const { data, error } = await supabase.functions.invoke('recovery-reschedule', { body })
  if (error) throw error
  return data
}

const shell = {
  minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column',
  alignItems: 'center', padding: '40px 16px',
}
const panel = {
  width: '100%', maxWidth: 520, background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
  borderRadius: 14, padding: '28px 24px',
}

export default function RescheduleLink() {
  const { token } = useParams()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(null)   // ISO of the time just booked
  const [dayIdx, setDayIdx] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    call({ action: 'info', token })
      .then(d => { if (!cancelled) setInfo(d) })
      .catch(() => { if (!cancelled) setError("We couldn't load this page. Please try again in a moment.") })
    return () => { cancelled = true }
  }, [token])

  const days = useMemo(() => {
    const map = new Map()
    for (const iso of info?.slots || []) {
      const d = new Date(iso)
      const k = dayKey(d)
      if (!map.has(k)) map.set(k, { date: d, slots: [] })
      map.get(k).slots.push({ iso, label: fmtTime(d) })
    }
    return [...map.values()]
  }, [info])

  async function pick(body) {
    setBusy(true); setError('')
    try {
      const r = await call({ action: 'pick', token, ...body })
      if (r.ok) { setPicked(r.at); return }
      if (r.reason === 'unavailable') {
        setError('That time was just taken. Pick another one.')
        setInfo(await call({ action: 'info', token }))
      } else {
        setError('This link is no longer active.')
        setInfo(await call({ action: 'info', token }))
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setBusy(false)
  }

  const first = info?.first_name
  let body
  if (!info && !error) {
    body = <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent)' }} />
  } else if (picked) {
    body = <Done title="You're all set" text={`We'll call you ${fmtFull(picked)}.`} />
  } else if (!info) {
    body = <p style={{ margin: 0, color: 'var(--danger)', fontSize: 15 }}>{error}</p>
  } else if (info.status === 'invalid') {
    body = <Plain title="This link isn't valid" text="Check that you opened the full link from the text message." />
  } else if (info.status === 'booked') {
    body = <Done title="You're all set" text={`We'll call you ${fmtFull(info.scheduled_call_at)}.`} />
  } else if (info.status === 'closed') {
    body = <Plain title="Nothing to change here" text="This call no longer needs a new time. If you have questions, reply to the text or call us back." />
  } else {
    const day = days[Math.min(dayIdx, days.length - 1)]
    body = (
      <>
        <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>
          {first ? `Hi ${first}, pick a time` : 'Pick a time'}
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {info.retry_at
            ? `We have a retry call set for ${fmtFull(info.retry_at)}. Choose another time below if that doesn't work.`
            : "Choose a time that works for you and we'll call you then."}
        </p>

        {days.length === 0 ? (
          <p style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)' }}>
            There are no open times right now. Please check back soon.
          </p>
        ) : (
          <>
            <button
              disabled={busy} onClick={() => pick({ asap: true })}
              style={{
                width: '100%', height: 46, borderRadius: 999, border: 'none', background: 'var(--accent)', color: '#fff',
                fontSize: 15, fontWeight: 600, opacity: busy ? 0.6 : 1, marginBottom: 20,
              }}
            >
              Call me as soon as possible
            </button>

            <p style={{ margin: '0 0 8px', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: MONO }}>
              Or choose a day and time
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {days.map((d, i) => (
                <button
                  key={dayKey(d.date)} onClick={() => setDayIdx(i)}
                  style={{
                    height: 36, padding: '0 14px', borderRadius: 999, fontSize: 13.5, fontWeight: i === dayIdx ? 600 : 500,
                    border: 'var(--border-w) solid ' + (i === dayIdx ? 'var(--accent)' : 'var(--border)'),
                    background: i === dayIdx ? 'var(--accent-dim)' : 'transparent',
                    color: i === dayIdx ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {fmtDay(d.date)}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8 }}>
              {day?.slots.map(s => (
                <button
                  key={s.iso} disabled={busy} onClick={() => pick({ at: s.iso })}
                  style={{
                    height: 42, borderRadius: 10, fontSize: 14, fontFamily: MONO, color: 'var(--text-primary)',
                    border: 'var(--border-w) solid var(--border-strong)', background: 'var(--bg-base)', opacity: busy ? 0.6 : 1,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              Times are shown in your local time zone.
            </p>
          </>
        )}
        {error && <p style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--danger)' }}>{error}</p>}
      </>
    )
  }

  return (
    <div style={shell}>
      <img src={ohvaraLogo} alt="Ohvara" style={{ height: 32, marginBottom: 24 }} />
      <div style={panel}>{body}</div>
    </div>
  )
}

function Done({ title, text }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <CalendarCheck size={34} style={{ color: 'var(--success)', marginBottom: 10 }} />
      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{text}</p>
    </div>
  )
}

function Plain({ title, text }) {
  return (
    <div>
      <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{text}</p>
    </div>
  )
}
