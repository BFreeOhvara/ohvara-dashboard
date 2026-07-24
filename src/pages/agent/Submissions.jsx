import { useMemo, useState } from 'react'
import { Check, CalendarClock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers } from '../../hooks/useCarriers'
import { usePolicies, useCreatePolicy, useUpdatePolicy, POLICY_STATUSES, PRE_SUBMISSION_STATUSES } from '../../hooks/usePolicies'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { ComingSoon } from '../../components/agent/ComingSoon'
import { money, fullName, formatDate, todayISO } from '../../lib/policyFormat'

// Submissions — three tabs (Round 33 / Round 38: the carrier-portal grid was
// pulled out into its own page, so it isn't a tab here).
const TABS = [
  { key: 'new',          label: 'New Submission' },
  { key: 'cancellation', label: 'Cancellation Calendar' },
  { key: 'contracting',  label: 'Contracting Submission' },
]

export default function Submissions() {
  const [tab, setTab] = useState('new')

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
          Submissions
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Submit a sold policy and schedule the 3-way cancellation call.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 8, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '7px 14px', borderRadius: 6, fontSize: 12,
              fontWeight: tab === t.key ? 500 : 400, cursor: 'pointer', border: 'none',
              background: tab === t.key ? 'var(--accent-dim)' : 'transparent',
              color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'new' && <NewSubmission />}
      {tab === 'cancellation' && <CancellationCalendar />}
      {tab === 'contracting' && (
        <ComingSoon
          title="Contracting Submission"
          description="New-agent carrier contracting — NPN, license state, and carrier appointment history — will land here."
        />
      )}
    </div>
  )
}

// ── New Submission ──────────────────────────────────────────────────────────
// Field list is the real reference form (Round 33), not invented. Annual
// premium is computed from monthly and displayed read-only — the database
// generates the stored value, this is just the live preview of it.
const BLANK = {
  policy_sold_date: todayISO(),
  policy_number: '',
  status: 'Submitted',
  client_first_name: '',
  client_last_name: '',
  client_phone: '',
  carrier_name: '',
  product_type: '',
  insurance_type: '',
  state: '',
  effective_date: '',
  monthly_premium: '',
  notes: '',
}

function NewSubmission() {
  const { profile } = useAuth()
  const { data: carriers = [] } = useCarriers()
  const create = useCreatePolicy()
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const monthly = Number(form.monthly_premium || 0)
  const annual = monthly * 12

  function submit() {
    setError('')
    if (!form.client_first_name.trim() || !form.client_last_name.trim()) {
      return setError("Enter the client's first and last name")
    }
    if (!form.monthly_premium || monthly <= 0) {
      return setError('Enter a monthly premium')
    }

    // carrier_id is set only when the typed name matches a carrier already in
    // the directory — free text still submits, since the directory is empty
    // until Brayden supplies the real appointed carriers.
    const match = carriers.find(c => c.name.toLowerCase() === form.carrier_name.trim().toLowerCase())

    create.mutate({
      agent_id: profile.id,
      policy_sold_date: form.policy_sold_date || null,
      policy_number: form.policy_number.trim() || null,
      status: form.status,
      client_first_name: form.client_first_name.trim(),
      client_last_name: form.client_last_name.trim(),
      client_phone: form.client_phone.trim() || null,
      carrier_id: match?.id || null,
      carrier_name: form.carrier_name.trim() || null,
      product_type: form.product_type.trim() || null,
      insurance_type: form.insurance_type.trim() || null,
      state: form.state.trim().toUpperCase() || null,
      effective_date: form.effective_date || null,
      monthly_premium: monthly,
      notes: form.notes.trim() || null,
    }, {
      onSuccess: () => {
        setForm(BLANK)
        setSaved(true)
        setTimeout(() => setSaved(false), 4000)
      },
      onError: err => setError(err.message || 'Could not save this submission'),
    })
  }

  return (
    <div className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <div className="flex flex-col gap-1.5">
          <label className="section-label">Policy Sold Date</label>
          <input type="date" className="date-field" value={form.policy_sold_date} onChange={e => set('policy_sold_date', e.target.value)} />
        </div>
        {/* Agent Name is the submitting agent, not a free choice — an agent
            can only ever write their own rows (RLS policies_insert). */}
        <Input label="Agent Name" value={profile?.full_name || ''} readOnly />
        <Input label="Policy #" value={form.policy_number} onChange={e => set('policy_number', e.target.value)} placeholder="Carrier policy number" />
        <Select label="Lead Status" value={form.status} onChange={e => set('status', e.target.value)}>
          {POLICY_STATUSES.filter(s => !PRE_SUBMISSION_STATUSES.includes(s)).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <Input label="Client First Name" value={form.client_first_name} onChange={e => set('client_first_name', e.target.value)} placeholder="Jordan" />
        <Input label="Client Last Name" value={form.client_last_name} onChange={e => set('client_last_name', e.target.value)} placeholder="Smith" />
        <Input label="Client Phone" value={form.client_phone} onChange={e => set('client_phone', e.target.value)} placeholder="(555) 010-1234" />
        <Input label="State" value={form.state} onChange={e => set('state', e.target.value)} placeholder="TX" maxLength={2} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <div className="flex flex-col gap-1.5">
          <label className="section-label">Insurance Provider</label>
          {/* A datalist, not a hard dropdown: the carrier directory is empty
              until the real appointed carriers are supplied, and a submission
              must never be blocked on that. */}
          <input
            list="carrier-options"
            value={form.carrier_name}
            onChange={e => set('carrier_name', e.target.value)}
            placeholder="Carrier name"
            className="date-field"
          />
          <datalist id="carrier-options">
            {carriers.map(c => <option key={c.id} value={c.name} />)}
          </datalist>
        </div>
        <Input label="Product Type" value={form.product_type} onChange={e => set('product_type', e.target.value)} placeholder="Term, Whole Life, IUL…" />
        <Input label="Insurance Type" value={form.insurance_type} onChange={e => set('insurance_type', e.target.value)} placeholder="Life" />
        <div className="flex flex-col gap-1.5">
          <label className="section-label">Effective Date</label>
          <input type="date" className="date-field" value={form.effective_date} onChange={e => set('effective_date', e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, alignItems: 'end' }}>
        <Input
          label="Monthly Premium"
          type="number"
          min="0"
          step="0.01"
          value={form.monthly_premium}
          onChange={e => set('monthly_premium', e.target.value)}
          placeholder="0.00"
        />
        <div>
          <p className="section-label" style={{ margin: 0 }}>Annual Premium (auto)</p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: '8px 0 0' }}>
            {money(annual)}
          </p>
        </div>
      </div>

      <Textarea label="Notes" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything worth remembering about this deal" />

      {error && (
        <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{error}</p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button size="lg" onClick={submit} disabled={create.isPending}>
          {create.isPending ? 'Submitting…' : 'Submit Policy'}
        </Button>
        {saved && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--success)' }}>
            <Check size={13} /> Submitted — it's in My Policies
          </span>
        )}
      </div>
    </div>
  )
}

// ── Cancellation Calendar ───────────────────────────────────────────────────
// The old policy can only be cancelled on a live 3-way call (closer + client +
// old carrier), so every sold deal needs one booked. This schedules that call
// against the policy record and lists what's already on the books.
function CancellationCalendar() {
  const { profile } = useAuth()
  const { data: policies = [] } = usePolicies(profile?.id)
  const update = useUpdatePolicy()
  const [draft, setDraft] = useState({})

  const { unscheduled, scheduled } = useMemo(() => {
    const open = policies.filter(p => p.cancellation_status !== 'Cancellation Complete')
    return {
      unscheduled: open.filter(p => !p.cancellation_call_at),
      scheduled: open
        .filter(p => p.cancellation_call_at)
        .sort((a, b) => a.cancellation_call_at.localeCompare(b.cancellation_call_at)),
    }
  }, [policies])

  function book(policy) {
    const value = draft[policy.id]
    if (!value) return
    update.mutate({
      id: policy.id,
      cancellation_call_at: new Date(value).toISOString(),
      // Booking the call is what puts the old policy into a pending state —
      // Complete is set by hand once the carrier confirms on the call.
      cancellation_status: policy.cancellation_status || 'Cancellation Pending',
    }, {
      onSuccess: () => setDraft(d => ({ ...d, [policy.id]: '' })),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="glass" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
          Needs a cancellation call
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 16px' }}>
          Every replacement deal needs a live 3-way call with the old carrier before it's actually done.
        </p>
        {unscheduled.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Nothing waiting to be scheduled.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {unscheduled.map(p => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '12px 14px', borderRadius: 8,
                background: 'var(--bg-base)', border: '0.5px solid var(--border)',
              }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{fullName(p)}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '3px 0 0' }}>
                    {p.carrier_name || 'No carrier'} · sold {formatDate(p.policy_sold_date)}
                  </p>
                </div>
                <input
                  type="datetime-local"
                  className="date-field"
                  style={{ width: 210 }}
                  value={draft[p.id] || ''}
                  onChange={e => setDraft(d => ({ ...d, [p.id]: e.target.value }))}
                />
                <Button size="sm" onClick={() => book(p)} disabled={!draft[p.id] || update.isPending}>
                  Schedule
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Scheduled</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 16px' }}>
          Upcoming 3-way calls, soonest first.
        </p>
        {scheduled.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No calls booked yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {scheduled.map(p => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '12px 14px', borderRadius: 8,
                background: 'var(--bg-base)', border: '0.5px solid var(--border)',
              }}>
                <CalendarClock size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{fullName(p)}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '3px 0 0' }}>
                    {new Date(p.cancellation_call_at).toLocaleString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit',
                    })}
                  </p>
                </div>
                {p.cancellation_status && <Badge label={p.cancellation_status} />}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={update.isPending || p.cancellation_status === 'Cancellation Complete'}
                  onClick={() => update.mutate({ id: p.id, cancellation_status: 'Cancellation Complete' })}
                >
                  Mark complete
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
