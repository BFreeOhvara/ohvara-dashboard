import { useMemo, useState } from 'react'
import { Plus, Trash2, Phone, Bell, FileText, CheckCircle, RotateCcw, XCircle, Clock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicies } from '../../hooks/usePolicies'
import { useFollowUps, useCreateFollowUp, useDeleteFollowUp } from '../../hooks/useFollowUps'
import { MONO, card, control, primaryBtn, ghostBtn } from '../../lib/exportStyles'
import { Field, TextField } from '../../components/ui/ExportForm'
import { fullName, todayISO } from '../../lib/policyFormat'

// My Calls (Prompt 329) — the export's mockup for this page was two
// "Coming soon" tabs (Calls / Activity); Brayden's real spec supersedes it
// with three sections built fresh in the same visual language:
//
//  · Schedule — Cancellation Calls (real, auto-populated from the booking
//    flow already in Submissions) merged with Follow-ups (new, closer-logged
//    CRUD — migration 076).
//  · Activity — a chronological feed derived from real policy fields.
//    There's no separate event-log table; each row is a timestamp the
//    schema already tracks (submitted, effectuation confirmed, cancellation
//    booked/completed), not invented history.
//  · Graded calls — flagged, not spec'd. No call-recording/QA-scoring system
//    exists anywhere in this app yet, so this ships "coming soon" rather
//    than guessing at what "graded" means.

const TABS = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'activity', label: 'Activity' },
  { key: 'graded',   label: 'Graded calls' },
]

export default function MyCalls() {
  const [tab, setTab] = useState('schedule')

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{
        display: 'flex', gap: 2, flexWrap: 'wrap',
        borderBottom: 'var(--border-w) solid var(--border)', marginBottom: 20,
      }}>
        {TABS.map(t => {
          const on = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                border: 'none', background: 'transparent', padding: '9px 14px',
                fontSize: 12.5, fontWeight: on ? 700 : 500,
                color: on ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'schedule' && <Schedule />}
      {tab === 'activity' && <Activity />}
      {tab === 'graded'   && <GradedCalls />}
    </div>
  )
}

// ── Schedule ─────────────────────────────────────────────────────────────────
function Schedule() {
  const { profile } = useAuth()
  const { data: policies = [] } = usePolicies(profile?.id)
  const { data: followUps = [] } = useFollowUps(profile?.id)
  const createFollowUp = useCreateFollowUp()
  const deleteFollowUp = useDeleteFollowUp()

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ client_name: '', date: todayISO(), time: '09:00', notes: '' })
  const [error, setError] = useState('')

  const items = useMemo(() => {
    const calls = policies
      .filter(p => p.cancellation_call_at)
      .map(p => ({
        id: `canc-${p.id}`, kind: 'cancellation', at: p.cancellation_call_at,
        name: fullName(p), detail: `3-way call w/ ${p.carrier_name || 'carrier'}`,
        deletable: false,
      }))
    const fus = followUps.map(f => ({
      id: f.id, kind: 'followup', at: f.scheduled_at,
      name: f.client_name, detail: f.notes || 'Follow-up call',
      deletable: true,
    }))
    return [...calls, ...fus].sort((a, b) => a.at.localeCompare(b.at))
  }, [policies, followUps])

  async function submit() {
    setError('')
    if (!form.client_name.trim()) return setError('Enter a client name')
    if (!form.date || !form.time) return setError('Pick a date and time')
    const scheduled_at = new Date(`${form.date}T${form.time}`).toISOString()
    try {
      await createFollowUp.mutateAsync({
        agent_id: profile.id, client_name: form.client_name.trim(),
        scheduled_at, notes: form.notes.trim() || null,
      })
      setForm({ client_name: '', date: todayISO(), time: '09:00', notes: '' })
      setAdding(false)
    } catch (err) {
      setError(err.message || 'Could not save the follow-up')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: adding ? 16 : 0 }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Upcoming</p>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
              Cancellation calls booked in Submissions, plus follow-ups you log yourself.
            </p>
          </div>
          {!adding && (
            <button onClick={() => setAdding(true)} style={ghostBtn}>
              <Plus size={13} /> Log follow-up
            </button>
          )}
        </div>

        {adding && (
          <div style={{ padding: '16px 0', borderTop: 'var(--border-w) solid var(--border)', marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
              <TextField label="Client" value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Who are you calling?" />
              <TextField label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} mono />
              <TextField label="Time" type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} mono />
            </div>
            <Field label="Notes (optional)" style={{ marginBottom: 12 }}>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="What's this call for?" style={control} />
            </Field>
            {error && <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={submit} disabled={createFollowUp.isPending} style={{ ...primaryBtn, opacity: createFollowUp.isPending ? 0.6 : 1 }}>
                {createFollowUp.isPending ? 'Saving…' : 'Save follow-up'}
              </button>
              <button onClick={() => { setAdding(false); setError('') }} style={ghostBtn}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {items.length === 0 ? (
          <p style={{ margin: 0, padding: '22px 24px', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Nothing on the calendar — book a cancellation call from Submissions, or log a follow-up above.
          </p>
        ) : items.map((it, i) => (
          <div
            key={it.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 24px',
              borderBottom: i < items.length - 1 ? 'var(--border-w) solid var(--border)' : 'none',
            }}
          >
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
              background: it.kind === 'cancellation' ? 'var(--warning-dim)' : 'var(--info-dim)',
              color: it.kind === 'cancellation' ? 'var(--warning)' : 'var(--info)',
              border: `var(--border-w) solid ${it.kind === 'cancellation' ? 'var(--warning-bd)' : 'var(--info-bd)'}`,
            }}>
              {it.kind === 'cancellation' ? <Phone size={10} /> : <Bell size={10} />}
              {it.kind === 'cancellation' ? 'CANCEL CALL' : 'FOLLOW-UP'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{it.name}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>{it.detail}</p>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
              {new Date(it.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
            {it.deletable && (
              <button
                onClick={() => deleteFollowUp.mutate(it.id)}
                title="Delete follow-up"
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', padding: 4, cursor: 'pointer' }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Activity ─────────────────────────────────────────────────────────────────
// Derived purely from real policy fields — no separate event log exists, so
// this is what a status change already implies, not invented history.
const EVENT_ICON = { submitted: FileText, effect: CheckCircle, undrafted: XCircle, followup: RotateCcw, cancelbooked: Phone, cancelcomplete: CheckCircle, effconfirmed: CheckCircle }
const EVENT_COLOR = { submitted: 'var(--info)', effect: 'var(--success)', undrafted: 'var(--danger)', followup: 'var(--warning)', cancelbooked: 'var(--warning)', cancelcomplete: 'var(--success)', effconfirmed: 'var(--success)' }

function Activity() {
  const { profile } = useAuth()
  const { data: policies = [], isLoading } = usePolicies(profile?.id)

  const events = useMemo(() => {
    const out = []
    for (const p of policies) {
      const name = fullName(p)
      if (p.created_at) out.push({ id: `${p.id}-sub`, type: 'submitted', label: `New submission — ${name}`, sub: p.carrier_name || 'Carrier not set', at: p.created_at })
      if (p.status === 'In Effect') out.push({ id: `${p.id}-eff`, type: 'effect', label: `Went into effect — ${name}`, sub: p.policy_number || '', at: p.effectuation_answered_at || p.updated_at })
      if (p.status === 'Undrafted') out.push({ id: `${p.id}-undraft`, type: 'undrafted', label: `Came back undrafted — ${name}`, sub: p.policy_number || '', at: p.updated_at })
      if (p.status === 'Follow-up') out.push({ id: `${p.id}-fu`, type: 'followup', label: `Marked follow-up — ${name}`, sub: p.notes || '', at: p.updated_at })
      if (p.cancellation_call_at) out.push({ id: `${p.id}-cb`, type: 'cancelbooked', label: `Cancellation call booked — ${name}`, sub: p.carrier_name || '', at: p.cancellation_call_at })
      if (p.cancellation_status === 'Cancellation Complete') out.push({ id: `${p.id}-cc`, type: 'cancelcomplete', label: `Cancellation completed — ${name}`, sub: 'Commission released from reserve', at: p.updated_at })
      if (p.effectuation_answered_at) out.push({ id: `${p.id}-ec`, type: 'effconfirmed', label: `Effectuation confirmed — ${name}`, sub: '', at: p.effectuation_answered_at })
    }
    return out.filter(e => e.at).sort((a, b) => b.at.localeCompare(a.at))
  }, [policies])

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      {isLoading ? (
        <p style={{ margin: 0, padding: '22px 24px', fontSize: 12.5, color: 'var(--text-muted)' }}>Loading…</p>
      ) : events.length === 0 ? (
        <p style={{ margin: 0, padding: '22px 24px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          No pipeline activity yet — it fills in as your policies move through status changes.
        </p>
      ) : events.map((e, i) => {
        const Icon = EVENT_ICON[e.type] || Clock
        const color = EVENT_COLOR[e.type] || 'var(--text-muted)'
        return (
          <div
            key={e.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '13px 24px',
              borderBottom: i < events.length - 1 ? 'var(--border-w) solid var(--border)' : 'none',
            }}
          >
            <span style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon size={13} style={{ color }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)' }}>{e.label}</p>
              {e.sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{e.sub}</p>}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
              {new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Graded calls ─────────────────────────────────────────────────────────────
// Flagged, not spec'd (Prompt 329): no call-recording/QA-scoring system
// exists anywhere in this app — Live Call itself is still a placeholder.
// Ships "coming soon" rather than guessing at who grades a call, on what
// criteria, from what recording/transcript source.
function GradedCalls() {
  return (
    <div style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8,
        padding: '64px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center',
        textAlign: 'center', gap: 16, maxWidth: 480,
      }}>
        <span style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Clock size={24} style={{ color: 'var(--accent)' }} />
        </span>
        <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Coming soon</p>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          No call-recording or QA-scoring system exists yet — Live Call itself has no call handling wired up.
          This needs a real answer from Brayden first: who grades a call, on what criteria, and from what
          recording or transcript source.
        </p>
      </div>
    </div>
  )
}
