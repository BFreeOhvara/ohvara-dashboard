import { useMemo, useState } from 'react'
import { CheckCircle2, ArrowRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers } from '../../hooks/useCarriers'
import { usePolicies, useCreatePolicy, useUpdatePolicy } from '../../hooks/usePolicies'
import { ComingSoon } from '../../components/agent/ComingSoon'
import {
  MONO, card, cardTitle, control, fieldLabel, grid3, primaryBtn, ghostBtn,
} from '../../lib/exportStyles'
import { Field, TextField, SelectField, GapNote } from '../../components/ui/ExportForm'
import { Segmented } from '../../components/ui/Segmented'
import { money, fullName, formatDate, todayISO } from '../../lib/policyFormat'
import { US_STATES } from '../../lib/usStates'

// Submissions — literal port of the export's "Closer · Submissions" screen
// (vault: media/claude-design-export-ohvara-dashboard-v3.html, lines
// 1307-1454): the Round 33 new-business form laid out three fields to a row,
// the auto annual-premium readout, and the projected-commission strip under
// a divider. Wired to the real `policies` table. Tab strip switched from the
// export's underlined style to the shared `Segmented` pill toggle (Prompt
// 361) for consistency with Performance's Production/Leaderboard tabs.
//
// Flagged deviations from the export, none of them silent substitutions:
//  · Insurance provider / product type / insurance type are hard <select>s in
//    the export, fed by `data3.js` (never handed over) and by a carrier
//    directory that is still empty on purpose. Kept as free text + datalist so
//    a real submission is never blocked on data Brayden hasn't supplied.
//  · State and Notes aren't in the export's grid, but both are real columns
//    and My Policies filters on state — kept, styled identically. State is a
//    hard <select> (Prompt 361, real closed 50-state+DC universe, no
//    data-availability risk the way carrier names have) rather than the
//    carrier field's free-text + datalist pattern.
//  · Projected commission renders an em-dash: comp-grid rates by
//    carrier/product/tier don't exist yet, so any figure would be invented.
//  · The export's cancellation tab books against nothing. Real bookings need
//    to know WHICH policy, so a policy picker leads that form, and what's
//    already booked is listed underneath.

const TABS = [
  { value: 'new',          label: 'New Submission' },
  { value: 'contracting',  label: 'Contracting Submission' },
  { value: 'cancellation', label: 'Cancellation Calendar' },
]

export default function Submissions() {
  const [tab, setTab] = useState('new')

  return (
    <div style={{ maxWidth: 1100 }}>
      <Segmented value={tab} onChange={setTab} options={TABS} style={{ marginBottom: 20 }} />

      {tab === 'new' && <NewSubmission />}
      {tab === 'contracting' && (
        <ComingSoon
          title="Coming soon"
          description="Contracting submission workflow will land here — NPN, license state and carrier appointment history."
        />
      )}
      {tab === 'cancellation' && <CancellationCalendar />}
    </div>
  )
}

// ── New Submission ──────────────────────────────────────────────────────────
const BLANK = {
  policy_sold_date: todayISO(),
  policy_number: '',
  client_first_name: '',
  client_last_name: '',
  client_phone: '',
  carrier_name: '',
  product_type: '',
  insurance_type: '',
  state: '',
  effective_date: '',
  monthly_premium: '',
  // Prompt 369: drives `pending_underwriting` — the only way "Not Approved"
  // is ever reachable, since carrier decisions aren't otherwise observable.
  underwriting_decision: 'immediate',
  notes: '',
}

function NewSubmission() {
  const { profile } = useAuth()
  const { data: carriers = [] } = useCarriers()
  const create = useCreatePolicy()
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const monthly = Number(form.monthly_premium || 0)
  const annual = monthly * 12

  // Only a carrier already in the directory can carry a portal link.
  const carrier = carriers.find(
    c => c.name.toLowerCase() === form.carrier_name.trim().toLowerCase()
  )

  function submit() {
    setError('')
    if (!form.client_first_name.trim() || !form.client_last_name.trim()) {
      return setError("Enter the client's first and last name")
    }
    if (!form.monthly_premium || monthly <= 0) {
      return setError('Enter a monthly premium')
    }

    create.mutate({
      agent_id: profile.id,
      policy_sold_date: form.policy_sold_date || null,
      policy_number: form.policy_number.trim() || null,
      // Always Submitted on creation — there's no scenario where a New
      // Submission starts as anything else (Prompt 361), so this is hardcoded
      // at the write rather than left as a UI choice.
      status: 'Submitted',
      client_first_name: form.client_first_name.trim(),
      client_last_name: form.client_last_name.trim(),
      client_phone: form.client_phone.trim() || null,
      carrier_id: carrier?.id || null,
      carrier_name: form.carrier_name.trim() || null,
      product_type: form.product_type.trim() || null,
      insurance_type: form.insurance_type.trim() || null,
      state: form.state || null,
      effective_date: form.effective_date || null,
      monthly_premium: monthly,
      pending_underwriting: form.underwriting_decision === 'needs_underwriting',
      notes: form.notes.trim() || null,
    }, {
      onSuccess: () => {
        setSaved(`${form.client_first_name.trim()} ${form.client_last_name.trim()}${form.carrier_name.trim() ? ` · ${form.carrier_name.trim()}` : ''}`)
        setForm(BLANK)
      },
      onError: err => setError(err.message || 'Could not save this submission'),
    })
  }

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <p style={cardTitle}>New business submission</p>

      <div style={grid3}>
        <TextField
          label="Policy sold date" type="date" mono
          value={form.policy_sold_date} onChange={e => set('policy_sold_date', e.target.value)}
        />
        <TextField
          label="Policy #" mono placeholder="e.g. 4471209"
          value={form.policy_number} onChange={e => set('policy_number', e.target.value)}
        />
        <TextField
          label="Client first name" placeholder="First name"
          value={form.client_first_name} onChange={e => set('client_first_name', e.target.value)}
        />
      </div>

      <div style={grid3}>
        <TextField
          label="Client last name" placeholder="Last name"
          value={form.client_last_name} onChange={e => set('client_last_name', e.target.value)}
        />
        <TextField
          label="Client phone" mono placeholder="(602) 555-0184"
          value={form.client_phone} onChange={e => set('client_phone', e.target.value)}
        />
        <Field label="Insurance provider">
          <input
            list="carrier-options"
            value={form.carrier_name}
            onChange={e => set('carrier_name', e.target.value)}
            placeholder="Carrier name"
            style={control}
          />
          <datalist id="carrier-options">
            {carriers.map(c => <option key={c.id} value={c.name} />)}
          </datalist>
        </Field>
      </div>

      <div style={grid3}>
        <TextField
          label="Product type" placeholder="Term, Whole Life, IUL…"
          value={form.product_type} onChange={e => set('product_type', e.target.value)}
        />
        <TextField
          label="Insurance type" placeholder="Life"
          value={form.insurance_type} onChange={e => set('insurance_type', e.target.value)}
        />
        <TextField
          label="Effective date" type="date" mono
          value={form.effective_date} onChange={e => set('effective_date', e.target.value)}
        />
      </div>

      <div style={grid3}>
        <TextField
          label="Monthly premium ($)" mono type="number" min="0" step="0.01" placeholder="118"
          value={form.monthly_premium} onChange={e => set('monthly_premium', e.target.value)}
        />
        <SelectField label="State" value={form.state} onChange={e => set('state', e.target.value)}>
          <option value="">Select a state</option>
          {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
        </SelectField>
        <SelectField
          label="Was this approved immediately, or does it need underwriting?"
          value={form.underwriting_decision}
          onChange={e => set('underwriting_decision', e.target.value)}
        >
          <option value="immediate">Approved immediately</option>
          <option value="needs_underwriting">Needs underwriting</option>
        </SelectField>
      </div>

      <div style={grid3}>
        <Field label="Notes" style={{ gridColumn: 'span 3' }}>
          <textarea
            rows={2}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Anything worth remembering about this deal"
            style={{ ...control, height: 'auto', padding: '8px 10px', resize: 'vertical' }}
          />
        </Field>
      </div>

      {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, paddingTop: 2, flexWrap: 'wrap' }}>
        <Field label="Annual premium (auto)">
          <div style={{
            height: 34, minWidth: 140, display: 'flex', alignItems: 'center', padding: '0 10px',
            background: 'var(--bg-panel)', border: 'var(--border-w) solid var(--border)',
            borderRadius: 6, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: MONO,
          }}>
            {money(annual)}
          </div>
        </Field>
        <div style={{ flex: 1 }} />
        <button onClick={submit} disabled={create.isPending} style={{ ...primaryBtn, opacity: create.isPending ? 0.6 : 1 }}>
          {create.isPending ? 'Logging…' : 'Log Submission'}
        </button>
        {saved && (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--success)', fontWeight: 700 }}>
              <CheckCircle2 size={13} /> Logged — {saved} · it's in My Policies
            </span>
            <button
              onClick={() => setSaved(null)}
              style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 11.5, padding: 0 }}
            >
              New submission
            </button>
          </>
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 14, marginTop: 16, paddingTop: 14,
        borderTop: 'var(--border-w) solid var(--border)', flexWrap: 'wrap',
      }}>
        <div>
          <p style={fieldLabel}>Projected commission</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-muted)', fontFamily: MONO }}>—</span>
            <span style={{
              display: 'inline-flex', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
              background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning-bd)',
            }}>
              Projected
            </span>
          </div>
          <GapNote>
            No figure yet — comp-grid rates by carrier, product and contract tier haven't been loaded, so
            anything shown here would be made up. It becomes a confirmed commission once the policy is active.
          </GapNote>
        </div>
        <div style={{ flex: 1 }} />
        {carrier?.portal_url ? (
          <a href={carrier.portal_url} target="_blank" rel="noreferrer" style={{ ...ghostBtn, height: 32, textDecoration: 'none' }}>
            Verify in {carrier.name} portal <ArrowRight size={11} />
          </a>
        ) : (
          <button
            disabled
            title={form.carrier_name.trim() ? 'No portal URL on file for this carrier — add it on Carrier Portals' : 'Pick a carrier first'}
            style={{ ...ghostBtn, height: 32, opacity: 0.5 }}
          >
            Verify in carrier portal <ArrowRight size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Cancellation Calendar ───────────────────────────────────────────────────
// The old policy can only be cancelled on a live 3-way call (closer + client +
// old carrier), so every replacement deal needs one booked against it.
const SLOTS = ['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM']

function slotToISO(dateStr, slot) {
  const [time, meridiem] = slot.split(' ')
  const [h, m] = time.split(':').map(Number)
  const hour = meridiem === 'PM' && h !== 12 ? h + 12 : meridiem === 'AM' && h === 12 ? 0 : h
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d, hour, m).toISOString()
}

function CancellationCalendar() {
  const { profile } = useAuth()
  const { data: policies = [] } = usePolicies(profile?.id)
  const update = useUpdatePolicy()

  const [policyId, setPolicyId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [slot, setSlot] = useState('')
  const [booked, setBooked] = useState(null)

  const { unscheduled, scheduled } = useMemo(() => {
    const open = policies.filter(p => p.cancellation_status !== 'Cancellation Complete')
    return {
      unscheduled: open.filter(p => !p.cancellation_call_at),
      scheduled: open
        .filter(p => p.cancellation_call_at)
        .sort((a, b) => a.cancellation_call_at.localeCompare(b.cancellation_call_at)),
    }
  }, [policies])

  const ready = policyId && date && slot

  function confirm() {
    if (!ready) return
    const policy = unscheduled.find(p => p.id === policyId)
    update.mutate({
      id: policyId,
      cancellation_call_at: slotToISO(date, slot),
      // Booking the call is what puts the old policy into a pending state —
      // Complete is set by hand once the carrier confirms on the call.
      cancellation_status: policy?.cancellation_status || 'Cancellation Pending',
    }, {
      onSuccess: () => {
        setBooked({ name: fullName(policy), date, slot })
        setPolicyId(''); setSlot('')
      },
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
      <div style={card}>
        <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          Book the 3-way cancellation call
        </p>
        <p style={{ margin: '0 0 18px', fontSize: 11.5, color: 'var(--text-muted)' }}>
          Pick a date and time to conference in the client and the old carrier to confirm cancellation.
        </p>

        {booked ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '32px 0', textAlign: 'center' }}>
            <CheckCircle2 size={22} style={{ color: 'var(--success)' }} />
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              Booked — {booked.name} · {formatDate(booked.date)} at {booked.slot}
            </p>
            <button
              onClick={() => setBooked(null)}
              style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 11.5, padding: 0 }}
            >
              Book another
            </button>
          </div>
        ) : unscheduled.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            Nothing waiting to be scheduled — every open policy already has a call on the books.
          </p>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <p style={fieldLabel}>Policy</p>
              <select value={policyId} onChange={e => setPolicyId(e.target.value)} style={{ ...control, padding: '0 8px', maxWidth: 420 }}>
                <option value="">Which deal is this call for?</option>
                {unscheduled.map(p => (
                  <option key={p.id} value={p.id}>
                    {fullName(p)}{p.carrier_name ? ` · ${p.carrier_name}` : ''} · sold {formatDate(p.policy_sold_date)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={fieldLabel}>Date</p>
              <input
                type="date" value={date} min={todayISO()} onChange={e => setDate(e.target.value)}
                style={{ ...control, width: 'auto', fontFamily: MONO }}
              />
            </div>

            <p style={fieldLabel}>Available times</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
              {SLOTS.map(s => {
                const on = slot === s
                return (
                  <button
                    key={s}
                    onClick={() => setSlot(s)}
                    style={{
                      height: 34, borderRadius: 6, fontSize: 12, fontWeight: 700,
                      border: `1px solid ${on ? 'var(--accent-border)' : 'var(--border)'}`,
                      background: on ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      color: on ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
            <GapNote>
              Every slot shows as open — there's no shared calendar behind this yet, so nothing here knows
              what else is on your day.
            </GapNote>

            <button
              onClick={confirm}
              disabled={!ready || update.isPending}
              style={{ ...primaryBtn, marginTop: 18, opacity: ready && !update.isPending ? 1 : 0.5 }}
            >
              {update.isPending ? 'Booking…' : 'Confirm booking'}
            </button>
          </>
        )}
      </div>

      {/* Not in the export — its mockup has no real bookings to show. Without
          this there's no way to see or close out a call you already booked. */}
      <div style={card}>
        <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>On the books</p>
        <p style={{ margin: '0 0 16px', fontSize: 11.5, color: 'var(--text-muted)' }}>
          Upcoming 3-way calls, soonest first. Mark one complete once the old carrier confirms on the call.
        </p>
        {scheduled.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>No calls booked yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {scheduled.map(p => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '11px 14px', borderRadius: 7,
                background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
              }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--text-muted)', fontFamily: MONO }}>
                    {new Date(p.cancellation_call_at).toLocaleString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}
                  </p>
                </div>
                <button
                  onClick={() => update.mutate({ id: p.id, cancellation_status: 'Cancellation Complete' })}
                  disabled={update.isPending}
                  style={{ ...ghostBtn, height: 28 }}
                >
                  Mark complete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
