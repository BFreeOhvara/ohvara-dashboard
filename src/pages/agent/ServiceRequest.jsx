import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ChevronRight, Search, Send, Sun, Clock, Moon } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { REQUEST_KINDS, NOTE_LABEL, kindLabel, useSubmitServiceRequest } from '../../hooks/useServiceRequests'
import { useWeeklyUsage } from '../../hooks/useBillingTiers'
import { capState, formatReset } from '../../lib/billing'
import { matchClients, placeOf, useNow } from '../../lib/agentBookings'
import { fullName, formatPhoneInput } from '../../lib/policyFormat'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { StepHead, WeeklyUsage, BookError, BookedCard, ClientAvatar, LoadError } from '../../components/agent/AgentUI'
import { PhoneBar } from '../../components/agent/phone/PhoneBook'
import { PhoneSubHead } from '../../components/layout/PhoneShell'

// Service request (migration 187): something needs doing on a client the agent
// already has. Pick the client, pick one of seven requests, add a note and the
// best time to reach them, send. One RPC (agent_submit_service_request). A
// request is not a submission, so it never moves the week's N of M.
//
// Shown only when submit_live is on and the agent has Servicing (Submit decides).

const BEST = [
  { value: 'morning', label: 'Morning', hint: 'Before noon', icon: Sun },
  { value: 'afternoon', label: 'Afternoon', hint: 'Noon to 5 PM', icon: Clock },
  { value: 'evening', label: 'Evening', hint: 'After 5 PM', icon: Moon },
]
const bestLabel = v => BEST.find(b => b.value === v)?.label || ''
const MSG = {
  no_servicing: 'Servicing isn’t on your account. You have Leads only, so this request can’t be sent.',
  not_live: 'Service requests are not open yet.',
}
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const SHOWN = 5

const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
const carrierOf = p => p.new_carrier_name || p.carrier_name || p.current_carrier || 'No carrier noted'
const phoneOf = p => formatPhoneInput(String(p.client_phone || '').replace(/^\+?1/, '')) || 'No phone'

function ClientRow({ p, onPick }) {
  const name = fullName(p)
  return (
    <button type="button" role="option" aria-selected="false" onClick={() => onPick(p.id)}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, padding: '8px 14px', background: 'transparent', border: 0, borderTop: '1px solid var(--ov-line)', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
      <span aria-hidden="true" style={{ width: 38, height: 38, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)' }}>{initials(name)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', ...ellipsis }}>{name}</b>
        <span style={{ display: 'block', marginTop: 1, fontSize: 13, color: 'var(--ov-mute)', ...ellipsis }}>{phoneOf(p)} · {carrierOf(p)}</span>
      </span>
      <ChevronRight size={17} strokeWidth={2.2} style={{ flexShrink: 0, color: 'var(--ov-faint)' }} aria-hidden="true" />
    </button>
  )
}

// A choice card: .ov-choice, 64 high, the border and icon carry the state.
function Choice({ on, onClick, title, hint, icon: Icon }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`ov-choice${on ? ' is-on' : ''}`}
      style={{ minHeight: 64, padding: '0 14px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', minWidth: 0, width: '100%' }}>
      {Icon && <Icon size={18} strokeWidth={2} style={{ flexShrink: 0, color: on ? 'var(--ov-pick)' : 'var(--ov-mute)' }} aria-hidden="true" />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, ...ellipsis }}>{title}</span>
        <span style={{ display: 'block', marginTop: 1, fontSize: 12.5, fontWeight: 500, color: on ? 'var(--ov-pick)' : 'var(--ov-mute)', ...ellipsis }}>{hint}</span>
      </span>
    </button>
  )
}

const errRing = on => (on ? { borderRadius: 14, outline: '1px solid var(--danger)', outlineOffset: 6 } : null)

export default function ServiceRequest({ onBack }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const phone = usePhoneLayout()
  const now = useNow(60e3)
  const goBack = onBack || (() => navigate(-1))
  const { data: rows = [], isLoading, isError, refetch } = useAgentBookings(profile?.id)
  const send = useSubmitServiceRequest()
  const { data: usage } = useWeeklyUsage(profile?.id)
  const cap = capState(usage)
  const resets = formatReset(usage?.week_end, profile?.timezone)

  const [query, setQuery] = useState('')
  const [pickedId, setPickedId] = useState(null)
  const [kind, setKind] = useState(null)
  const [note, setNote] = useState('')
  const [best, setBest] = useState(null)
  const [errors, setErrors] = useState(new Set())
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  const clients = useMemo(() => [...rows].sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { numeric: true })), [rows])
  const found = query.trim() ? matchClients(rows, query) : clients
  const shown = found.slice(0, SHOWN)
  const picked = pickedId ? rows.find(p => p.id === pickedId) || null : null
  const pickedName = picked ? fullName(picked) : ''

  const clear = k => setErrors(e => { if (!e.has(k)) return e; const n = new Set(e); n.delete(k); return n })
  const pick = id => { setPickedId(id); clear('client'); setError('') }
  const chooseKind = v => { setKind(v); clear('kind'); setError('') }

  function submit() {
    setError('')
    const missing = new Set()
    if (!picked) missing.add('client')
    if (!kind) missing.add('kind')
    if (!note.trim()) missing.add('note')
    if (!best) missing.add('best')
    if (missing.size) {
      setErrors(missing)
      setError('Pick a client and a request, add a note and a best time.')
      return
    }
    setErrors(new Set())
    send.mutate({ policyId: picked.id, kind, note: note.trim(), bestTime: best }, {
      onSuccess: () => {
        setDone({ id: picked.id, name: pickedName, first: pickedName.split(' ')[0], kind, best })
        setPickedId(null); setKind(null); setNote(''); setBest(null); setQuery('')
      },
      onError: err => setError(MSG[err.hint] || err.message || 'Could not send this request. Try again.'),
    })
  }

  if (done) {
    const steps = [
      ['Our servicing team picks it up', 'They have your note'],
      [`We call ${done.first}`, `${bestLabel(done.best)} is best, their local time`],
    ]
    const card = (
      <BookedCard
        name={done.name} now={now} chip="Request sent" extraChip="Didn’t use a submission" line={kindLabel(done.kind)}
        box={(
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>What happens next</div>
            <ul style={{ margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {steps.map(([t, s], i) => (
                <li key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 15, lineHeight: 1.4, listStyle: 'none' }}>
                  <span className="ov-hero-chip" style={{ width: 22, height: 22, padding: 0, justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-display)', fontSize: 12 }}>{i + 1}</span>
                  <span>{t}<span style={{ display: 'block', fontSize: 13, color: 'var(--ov-hero-soft)' }}>{s}</span></span>
                </li>
              ))}
            </ul>
          </div>
        )}
        anotherLabel="Send another" pipelineLabel="View in Clients"
        onAnother={() => setDone(null)}
        onPipeline={() => navigate(done.id ? `/agent/clients?open=${done.id}` : '/agent/clients')}
      />
    )
    if (!phone) return card
    return (
      <>
        <div style={{ margin: '-4px -16px 0' }}><PhoneSubHead title="Request sent" onBack={() => navigate('/agent')} /></div>
        {card}
      </>
    )
  }

  const busy = send.isPending
  const showCap = cap && cap.cap != null
  const noClients = !isLoading && !isError && rows.length === 0

  const clientBody = picked ? (
    <div className="ov-note" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14 }}>
      <span aria-hidden="true" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ph-check-bg)', color: 'var(--ph-check-fg)' }}><Check size={14} strokeWidth={3} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', ...ellipsis }}>{pickedName}</b>
        <span style={{ display: 'block', marginTop: 1, fontSize: 13, color: 'var(--ov-mute)', ...ellipsis }}>{phoneOf(picked)} · {carrierOf(picked)}</span>
      </span>
      <button type="button" className="ov-ghost" onClick={() => setPickedId(null)} style={{ height: 44, padding: '0 18px', fontSize: 14, flexShrink: 0 }}>Change</button>
    </div>
  ) : (
    <>
      <label className={`ov-input${errors.has('client') ? ' is-error' : ''}`}>
        <Search size={17} strokeWidth={1.9} style={{ flexShrink: 0 }} aria-hidden="true" />
        <input aria-label="Search your clients" placeholder="Name, phone or carrier" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      {isLoading ? (
        <div aria-busy="true" style={{ border: '1px solid var(--ov-line)', borderRadius: 14, overflow: 'hidden' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, padding: '8px 14px', borderTop: i ? '1px solid var(--ov-line)' : 0 }}>
              <span className="ov-skel" style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                <span className="ov-skel" style={{ display: 'block', width: '46%', height: 13 }} />
                <span className="ov-skel" style={{ display: 'block', width: '70%', height: 12, marginTop: 6 }} />
              </span>
            </div>
          ))}
        </div>
      ) : isError ? (
        <LoadError what="your clients" onRetry={() => refetch()} />
      ) : noClients ? (
        <div className="ov-note" style={{ padding: '26px 18px', borderRadius: 14, textAlign: 'center', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
          <b style={{ display: 'block', marginBottom: 2, fontSize: 15, fontWeight: 600, color: 'var(--ov-mid)' }}>No clients yet</b>
          Requests are for clients you already have. Submit a deal first.
          <div><button type="button" className="ov-ghost" onClick={goBack} style={{ height: 44, padding: '0 18px', fontSize: 14, marginTop: 12 }}>Submit a deal</button></div>
        </div>
      ) : !found.length ? (
        <div className="ov-note" style={{ padding: '26px 18px', borderRadius: 14, textAlign: 'center', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
          <b style={{ display: 'block', marginBottom: 2, fontSize: 15, fontWeight: 600, color: 'var(--ov-mid)' }}>No client matches “{query.trim()}”</b>
          Check the spelling, or search by phone number.
        </div>
      ) : (
        <>
          <div role="listbox" aria-label="Your clients" style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--ov-line)', borderRadius: 14, overflow: 'hidden', ...(errors.has('client') ? { borderColor: 'var(--danger)' } : null) }}>
            {shown.map((p, i) => <div key={p.id} style={i === 0 ? { marginTop: -1 } : undefined}><ClientRow p={p} onPick={pick} /></div>)}
          </div>
          {found.length > shown.length && <p style={{ margin: 0, fontSize: 13, color: 'var(--ov-mute)' }}>Showing {shown.length} of {found.length}. Search to find the rest.</p>}
        </>
      )}
    </>
  )

  const groups = [
    { label: 'A change on the policy', kinds: REQUEST_KINDS.filter(k => k.group === 'change'), cols: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' },
    { label: 'Help', kinds: REQUEST_KINDS.filter(k => k.group === 'help'), cols: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' },
  ]
  const kindBody = groups.map(g => (
    <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>{g.label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: g.cols, gap: 12, ...errRing(errors.has('kind')) }}>
        {g.kinds.map(k => <Choice key={k.value} on={kind === k.value} onClick={() => chooseKind(k.value)} title={k.label} hint={k.hint} />)}
      </div>
    </div>
  ))

  const noteBody = (
    <>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>{kind ? NOTE_LABEL[kind] : 'What’s going on'}</span>
        <span className={`ov-input${errors.has('note') ? ' is-error' : ''}`} style={{ height: 'auto', padding: '12px 14px', alignItems: 'flex-start' }}>
          <textarea rows={3} maxLength={1000} placeholder="Anything our team needs to get this done" value={note}
            onChange={e => { setNote(e.target.value); clear('note') }} aria-invalid={errors.has('note') || undefined}
            style={{ flex: 1, minWidth: 0, width: '100%', minHeight: 86, padding: 0, border: 0, outline: 0, resize: 'vertical', background: 'transparent', font: 'inherit', fontSize: 15, lineHeight: 1.5, color: 'var(--ov-hi)' }} />
        </span>
      </label>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>Best time to reach them</div>
        <div style={{ marginTop: 1, fontSize: 13, fontWeight: 500, color: 'var(--ov-mute)' }}>Client’s local time.</div>
      </div>
      {phone ? (
        <div className={`ph-opts c3${errors.has('best') ? ' is-error' : ''}`}>
          {BEST.map(b => (
            <button key={b.value} type="button" className={`ph-opt tm${best === b.value ? ' is-on' : ''}`} aria-pressed={best === b.value} onClick={() => { setBest(b.value); clear('best') }}>
              <b.icon size={18} strokeWidth={2} aria-hidden="true" /><b>{b.label}</b><small style={{ whiteSpace: 'normal' }}>{b.hint}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3" style={errRing(errors.has('best'))}>
          {BEST.map(b => <Choice key={b.value} on={best === b.value} onClick={() => { setBest(b.value); clear('best') }} title={b.label} hint={b.hint} icon={b.icon} />)}
        </div>
      )}
    </>
  )

  const meter = showCap && (
    <WeeklyUsage cap={cap} resets={resets} title="Submissions this week" note={<div style={{ fontSize: 13, color: 'var(--ov-mute)' }}>{cap.tierName} plan · resets {resets}. Requests don’t count.</div>} />
  )

  // ── phone ──────────────────────────────────────────────────────────────
  if (phone) {
    const label = { fontSize: 12, fontWeight: 600, color: 'var(--ov-data-a)' }
    const card = { padding: '16px 14px 18px', borderRadius: 22, display: 'flex', flexDirection: 'column', gap: 16 }
    const pill = showCap && (
      <span className={`ph-usepill${cap.atCap ? ' is-full' : ''}`}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} aria-hidden="true" />{cap.used} of {cap.cap} used
      </span>
    )
    return (
      <div className="ph-book">
        <div style={{ margin: '-4px -16px 0' }}><PhoneSubHead title="Service request" onBack={goBack} right={pill} /></div>
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {picked ? (
            <section className="ov-card ph-sumcard" style={{ borderRadius: 20 }}>
              <span className="ph-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ov-mute)' }}>1 · Which client</span>
                <span className="ph-row-title" style={{ marginTop: 2, fontSize: 15 }}>{pickedName}</span>
                <span className="ph-row-sub">{phoneOf(picked)} · {carrierOf(picked)}</span>
              </span>
              <button type="button" className="ov-ghost ph-edit" onClick={() => setPickedId(null)}>Change</button>
            </section>
          ) : (
            <section className="ov-card" style={card}><div style={label}>1 · Which client</div>{clientBody}</section>
          )}
          <section className="ov-card" style={card}><div style={label}>2 · What do they need</div>{kindBody}</section>
          <section className="ov-card" style={card}><div style={label}>3 · The details</div>{noteBody}</section>
        </div>
        <PhoneBar error={error} onClick={submit} busy={busy} small={pickedName || 'Service request'} big={kind ? kindLabel(kind) : 'Pick a request'} label="Send" busyLabel="Sending…" />
      </div>
    )
  }

  // ── desktop ────────────────────────────────────────────────────────────
  const cardCls = 'ov-card flex flex-col gap-[18px] sm:gap-5 px-[18px] pt-5 pb-[22px] sm:px-7 sm:pt-[26px] sm:pb-7'
  const soft = { fontSize: 14, color: 'var(--ov-hero-soft)' }
  const row = (l, v) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, ...soft }}>
      <span>{l}</span>
      <b style={{ fontWeight: v ? 600 : 500, color: v ? 'inherit' : 'var(--ov-hero-soft)', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{v || 'Not picked'}</b>
    </div>
  )
  return (
    <div className="pb-[110px] sm:pb-0">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button type="button" className="ov-ghost" onClick={goBack} aria-label="Back" style={{ width: 44, height: 44, padding: 0, flexShrink: 0 }}>
          <ArrowRight size={20} strokeWidth={2.2} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div style={{ minWidth: 0 }}>
          <h2 className="text-[22px] sm:text-[26px]" style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.1, color: 'var(--ov-hi)' }}>Service request</h2>
          <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>Something needs doing on a client you already have.</p>
        </div>
      </div>
      <div className="ov-book">
        <div className="flex flex-col gap-[14px] sm:gap-5" style={{ minWidth: 0 }}>
          <section className={cardCls}>
            <StepHead n={1} title="Which client" sub="Search your clients by name, phone or carrier" />
            {clientBody}
          </section>
          <section className={cardCls}>
            <StepHead n={2} title="What do they need" sub="Pick one" />
            {kindBody}
          </section>
          <section className={cardCls}>
            <StepHead n={3} title="The details" sub="What our team needs to get it done" />
            {noteBody}
          </section>
        </div>
        <div className="ov-book-side" style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div className="ov-hero" style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '26px 26px 22px' }}>
            <span className="ov-hero-chip" style={{ alignSelf: 'flex-start' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ov-hero-dot)' }} />Request summary
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <ClientAvatar name={pickedName} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, overflowWrap: 'anywhere' }}>{pickedName || 'Pick a client'}</div>
                <div style={{ marginTop: 3, ...soft }}>{picked ? phoneOf(picked) : 'From your client list'}</div>
                {picked && <div style={{ marginTop: 3, ...soft }}>{[carrierOf(picked), placeOf(picked)].filter(Boolean).join(' · ')}</div>}
              </div>
            </div>
            <div style={{ height: 1, background: 'var(--ov-hero-soft)', opacity: 0.25 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {row('Request', kindLabel(kind))}
              {row('Best time', bestLabel(best))}
            </div>
            <button type="button" onClick={submit} disabled={busy} className="ov-hero-btn"
              style={{ width: '100%', height: 52, fontSize: 16, flexShrink: 0, ...(busy ? { opacity: 0.6, cursor: 'not-allowed' } : null) }}>
              <Send size={17} strokeWidth={2.2} />{busy ? 'Sending…' : 'Send request'}
            </button>
            <div style={{ marginTop: -6, textAlign: 'center', fontSize: 13, color: 'var(--ov-hero-soft)' }}>Doesn’t use a submission</div>
            {error && <BookError>{error}</BookError>}
          </div>
          {meter}
        </div>
      </div>
    </div>
  )
}
