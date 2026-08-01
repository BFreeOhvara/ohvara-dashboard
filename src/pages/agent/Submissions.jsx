import { useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers } from '../../hooks/useCarriers'
import { useCommissionSchedule } from '../../hooks/useCommissionSchedule'
import { usePolicies, useCreatePolicy, useUpdatePolicy } from '../../hooks/usePolicies'
import { ComingSoon } from '../../components/agent/ComingSoon'
import {
  MONO, card, cardTitle, control, fieldLabel, grid3, primaryBtn, ghostBtn,
} from '../../lib/exportStyles'
import { Field, TextField, AnchoredSelectField, GapNote } from '../../components/ui/ExportForm'
import { Segmented } from '../../components/ui/Segmented'
import { money, fullName, formatDate, todayISO, formatPhoneInput, titleCase } from '../../lib/policyFormat'
import { US_STATES } from '../../lib/usStates'

// Submissions — literal port of the export's "Closer · Submissions" screen
// (vault: media/claude-design-export-ohvara-dashboard-v3.html, lines
// 1307-1454): the Round 33 new-business form laid out three fields to a row
// and the auto annual-premium readout. Wired to the real `policies` table.
// Tab strip switched from the export's underlined style to the shared
// `Segmented` pill toggle (Prompt 361) for consistency with Performance's
// Production/Leaderboard tabs. The export's own projected-commission strip
// (Prompt 373) was dropped — Brayden didn't ask for a live preview widget on
// this form; the real Compensation Grid page (Prompt 370) covers that need.
//
// Flagged deviations from the export, none of them silent substitutions:
//  · Insurance provider / product type were free-text + datalist through
//    Prompt 359 (the carrier directory was still empty then). Prompt 378
//    replaces both with real dependent dropdowns once the carrier
//    directory (migration 078/080/082) and the Compensation Grid's real
//    comp data (migration 086, Prompt 370) landed — Product is empty/
//    disabled until a Carrier is picked, then lists that carrier's real
//    products from `commission_schedule`. This intentionally drops the old
//    free-text escape hatch for an unlisted carrier — Brayden's ask, not a
//    silent regression; if he wants a manual "Other" fallback later he'll
//    ask. The 3 carriers still `commission_schedule`-empty (Aflac,
//    Baltimore Life, Chubb — "AWAITING REAL DATA" placeholder rows) fall
//    back to free-text Product automatically, keyed off whether real rows
//    exist for that carrier rather than a hardcoded carrier-name check, so
//    the fallback stops applying the moment real data lands for one of them.
//  · Insurance type is still free text — the export's hard `<select>` here
//    is fed by `data3.js`, never handed over.
//  · State and Notes aren't in the export's grid, but both are real columns
//    and My Policies filters on state — kept, styled identically.
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
  product_name: '',
  state: '',
  effective_date: '',
  monthly_premium: '',
  // Prompt 369: drives `pending_underwriting` — the only way "Not Approved"
  // is ever reachable, since carrier decisions aren't otherwise observable.
  // Prompt 401: starts unselected (was defaulted to 'immediate'/Approved) so
  // an agent has to make an explicit pick instead of silently submitting
  // under whatever the default happened to be.
  underwriting_decision: '',
}

// Prompt 401 — every field but Annual Premium (auto-computed) is required to
// log a submission. Effective Date is handled separately below rather than
// listed here: Brayden's explicit call after a code check was that it's only
// required once Approved is picked — a policy still in underwriting
// genuinely has no effective date yet, and usePolicies.js's
// pendingUnderwriting()/pendingEffectuation() already treat "still in
// underwriting" and "has an effective date to react to" as mutually
// exclusive states, so forcing one here would just push agents toward
// placeholder dates.
const REQUIRED_FIELDS = [
  ['policy_sold_date', 'Policy sold date'],
  ['policy_number', 'Policy #'],
  ['client_first_name', 'Client first name'],
  ['client_last_name', 'Client last name'],
  ['client_phone', 'Client phone'],
  ['carrier_name', 'Insurance provider'],
  ['product_name', 'Product type'],
  ['monthly_premium', 'Monthly premium'],
  ['state', 'State'],
  ['underwriting_decision', 'Approved / In Underwriting'],
]

function NewSubmission() {
  const { profile } = useAuth()
  const { data: carriers = [] } = useCarriers()
  const { data: commissionRows = [] } = useCommissionSchedule()
  const create = useCreatePolicy()
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)
  // Prompt 401 — which required fields are currently missing, so their
  // border can highlight red; cleared per-field as soon as the agent edits
  // it, not just on the next submit attempt.
  const [fieldErrors, setFieldErrors] = useState(new Set())

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setFieldErrors(errs => {
      if (!errs.has(k)) return errs
      const next = new Set(errs)
      next.delete(k)
      return next
    })
  }
  const monthly = Number(form.monthly_premium || 0)
  const annual = monthly * 12

  // Only a carrier already in the directory can carry a portal link.
  const carrier = carriers.find(
    c => c.name.toLowerCase() === form.carrier_name.trim().toLowerCase()
  )

  // Prompt 378: products for the selected carrier, and whether that carrier
  // has any real comp data at all — driven by the data itself (does at least
  // one row have a non-null `pct`), not a hardcoded list of the 3 carriers
  // still waiting on Brayden, so this stops applying the moment real rows
  // land for one of them.
  const carrierProducts = useMemo(() => {
    const seen = new Map()
    for (const r of commissionRows) {
      if (r.carrier !== form.carrier_name) continue
      if (r.pct == null) continue
      if (!seen.has(r.product)) seen.set(r.product, r.type)
    }
    return [...seen.entries()].map(([product, type]) => ({ product, type })).sort((a, b) => a.product.localeCompare(b.product))
  }, [commissionRows, form.carrier_name])
  const carrierHasRealData = form.carrier_name && carrierProducts.length > 0

  // The chosen product's broad category (IUL/TL/WL/…), looked up for
  // whichever carrier+product is currently selected — stored on submit as
  // `product_type` so filters/badges elsewhere keep working off a short
  // code instead of the specific product string (that goes to the new
  // `product_name` column instead, see migration 088).
  const selectedProductType = carrierProducts.find(p => p.product === form.product_name)?.type || null

  // Prompt 401 — every REQUIRED_FIELDS entry plus Effective Date, but only
  // when Approved is picked (see the comment on REQUIRED_FIELDS for why).
  function validate() {
    const missing = REQUIRED_FIELDS.filter(([key]) =>
      key === 'monthly_premium' ? (!form.monthly_premium || monthly <= 0) : !String(form[key] || '').trim()
    )
    if (form.underwriting_decision === 'immediate' && !form.effective_date) {
      missing.push(['effective_date', 'Effective date'])
    }
    return missing
  }

  function submit() {
    setError('')
    const missing = validate()
    if (missing.length > 0) {
      setFieldErrors(new Set(missing.map(([key]) => key)))
      setError(`Fill in the highlighted field${missing.length > 1 ? 's' : ''} before logging this submission: ${missing.map(([, label]) => label).join(', ')}`)
      return
    }
    setFieldErrors(new Set())

    // Prompt 401 — normalized to title case on submit only, not while typing.
    const firstName = titleCase(form.client_first_name)
    const lastName = titleCase(form.client_last_name)

    create.mutate({
      agent_id: profile.id,
      policy_sold_date: form.policy_sold_date || null,
      policy_number: form.policy_number.trim() || null,
      // Always Submitted on creation — there's no scenario where a New
      // Submission starts as anything else (Prompt 361), so this is hardcoded
      // at the write rather than left as a UI choice.
      status: 'Submitted',
      client_first_name: firstName,
      client_last_name: lastName,
      client_phone: form.client_phone.trim() || null,
      carrier_id: carrier?.id || null,
      carrier_name: form.carrier_name.trim() || null,
      product_name: form.product_name.trim() || null,
      product_type: selectedProductType,
      // Prompt 380: every policy Ohvara writes is life insurance — no longer
      // asked on the form, hardcoded here instead so PolicyModal's Insurance
      // Type row (and anything else reading this column) keeps real data
      // instead of going blank.
      insurance_type: 'Life',
      state: form.state || null,
      effective_date: form.effective_date || null,
      monthly_premium: monthly,
      pending_underwriting: form.underwriting_decision === 'needs_underwriting',
    }, {
      onSuccess: () => {
        setSaved(`${firstName} ${lastName}${form.carrier_name.trim() ? ` · ${form.carrier_name.trim()}` : ''}`)
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
          error={fieldErrors.has('policy_sold_date')}
        />
        <TextField
          label="Policy #" mono placeholder="e.g. 4471209"
          value={form.policy_number} onChange={e => set('policy_number', e.target.value)}
          error={fieldErrors.has('policy_number')}
        />
        <TextField
          label="Client first name" placeholder="First name"
          value={form.client_first_name} onChange={e => set('client_first_name', e.target.value)}
          error={fieldErrors.has('client_first_name')}
        />
      </div>

      <div style={grid3}>
        <TextField
          label="Client last name" placeholder="Last name"
          value={form.client_last_name} onChange={e => set('client_last_name', e.target.value)}
          error={fieldErrors.has('client_last_name')}
        />
        <TextField
          label="Client phone" mono placeholder="(602) 555-0184"
          value={form.client_phone} onChange={e => set('client_phone', formatPhoneInput(e.target.value))}
          error={fieldErrors.has('client_phone')}
        />
        <AnchoredSelectField
          label="Insurance provider"
          value={form.carrier_name}
          onChange={val => {
            setForm(f => ({ ...f, carrier_name: val, product_name: '' }))
            setFieldErrors(errs => {
              if (!errs.has('carrier_name')) return errs
              const next = new Set(errs)
              next.delete('carrier_name')
              return next
            })
          }}
          placeholder="Select a carrier"
          options={carriers.map(c => ({ value: c.name, label: c.name }))}
          error={fieldErrors.has('carrier_name')}
        />
      </div>

      <div style={grid3}>
        {carrierHasRealData ? (
          <AnchoredSelectField
            label="Product type"
            value={form.product_name}
            onChange={val => set('product_name', val)}
            placeholder="Select a product"
            options={carrierProducts.map(p => ({ value: p.product, label: p.product }))}
            error={fieldErrors.has('product_name')}
          />
        ) : (
          <TextField
            label="Product type" placeholder={form.carrier_name ? 'No comp data yet — enter the product name' : 'Choose a carrier first'}
            disabled={!form.carrier_name}
            value={form.product_name} onChange={e => set('product_name', e.target.value)}
            error={fieldErrors.has('product_name')}
          />
        )}
        <TextField
          label="Effective date" type="date" mono
          value={form.effective_date} onChange={e => set('effective_date', e.target.value)}
          error={fieldErrors.has('effective_date')}
        />
      </div>

      <div style={grid3}>
        <TextField
          label="Monthly premium ($)" mono type="number" min="0" step="0.01" placeholder="118"
          value={form.monthly_premium} onChange={e => set('monthly_premium', e.target.value)}
          error={fieldErrors.has('monthly_premium')}
        />
        <AnchoredSelectField
          label="State"
          value={form.state}
          onChange={val => set('state', val)}
          placeholder="Select a state"
          options={US_STATES.map(s => ({ value: s.code, label: s.name }))}
          error={fieldErrors.has('state')}
        />
        <AnchoredSelectField
          label="Is this policy already approved or in underwriting?"
          value={form.underwriting_decision}
          onChange={val => set('underwriting_decision', val)}
          placeholder="Select an answer"
          options={[
            { value: 'immediate', label: 'Approved' },
            { value: 'needs_underwriting', label: 'In Underwriting' },
          ]}
          error={fieldErrors.has('underwriting_decision')}
        />
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
            <div style={{ marginBottom: 16, maxWidth: 420 }}>
              <AnchoredSelectField
                label="Policy"
                value={policyId}
                onChange={setPolicyId}
                placeholder="Which deal is this call for?"
                options={unscheduled.map(p => ({
                  value: p.id,
                  label: `${fullName(p)}${p.carrier_name ? ` · ${p.carrier_name}` : ''} · sold ${formatDate(p.policy_sold_date)}`,
                }))}
              />
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
