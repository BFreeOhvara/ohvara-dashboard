import { useMemo, useState } from 'react'
import { CheckCircle2, MessageCircleMore, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers } from '../../hooks/useCarriers'
import { useCommissionSchedule } from '../../hooks/useCommissionSchedule'
import { usePolicies, useCreatePolicy, useUpdatePolicy } from '../../hooks/usePolicies'
import { useCreateFulfillmentDetails } from '../../hooks/useFulfillmentDetails'
import { ComingSoon } from '../../components/agent/ComingSoon'
import {
  MONO, card, cardTitle, control, fieldLabel, grid3, primaryBtn, ghostBtn,
} from '../../lib/exportStyles'
import { Field, TextField, AnchoredSelectField, GapNote } from '../../components/ui/ExportForm'
import { Segmented } from '../../components/ui/Segmented'
import { money, fullName, formatDate, todayISO, formatPhoneInput, titleCase } from '../../lib/policyFormat'
import { US_STATES } from '../../lib/usStates'
import { SLOTS, slotToISO } from '../../lib/scheduling'

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
// Prompt 423 — this form is now unconditionally the Fulfillment intake flow;
// Prompt 418/419's "Send to Fulfillment Team" toggle and the self-write-only
// fields it used to gate (Policy #, Effective date, Approved/In Underwriting)
// are gone. Every submission routes to Fulfillment now.
const BLANK = {
  policy_sold_date: todayISO(),
  client_first_name: '',
  client_last_name: '',
  client_phone: '',
  carrier_name: '',
  product_name: '',
  state: '',
  monthly_premium: '',
  // The callback time the agent books for the client with Fulfillment.
  scheduled_call_at: '',
}

// Prompt 401 — every field but Annual Premium (auto-computed) is required to
// log a submission.
// Prompt 423 — Callback time is the one new required field now that Policy
// #/Effective date/Underwriting decision are gone entirely (Fulfillment
// hasn't written the policy yet, so none of those are knowable at submit).
const REQUIRED_FIELDS = [
  ['policy_sold_date', 'Policy sold date'],
  ['client_first_name', 'Client first name'],
  ['client_last_name', 'Client last name'],
  ['client_phone', 'Client phone'],
  ['carrier_name', 'Insurance provider'],
  ['product_name', 'Product type'],
  ['monthly_premium', 'Monthly premium'],
  ['state', 'State'],
  ['scheduled_call_at', 'Callback time'],
]

// Prompt 419 — the full Fulfillment intake: "everything needed to actually
// write the policy and cancel the old one" per Brayden's own framing, so
// every field here is required rather than optional-and-hope-Fulfillment-
// can-track-it-down.
// Prompt 423 — full_legal_name dropped (the form already asks Client First/
// Last Name up top; doSubmit() derives it from those instead of asking
// twice). beneficiary_name/beneficiary_relationship dropped in favor of the
// beneficiaries array below (migration 105).
const BLANK_DETAILS = {
  date_of_birth: '', state_of_birth: '', state_of_residence: '',
  email: '', height: '', weight: '',
  address_street: '', address_city: '', address_state: '', address_zip: '',
  drivers_license_number: '',
  draft_day: '',
  bank_name: '', routing_number: '', account_number: '',
  current_carrier: '',
}

const DETAILS_REQUIRED_FIELDS = [
  ['date_of_birth', 'Date of birth'],
  ['state_of_birth', 'State of birth'],
  ['state_of_residence', 'State of residence'],
  ['email', 'Email'],
  ['height', 'Height'],
  ['weight', 'Weight'],
  ['address_street', 'Street address'],
  ['address_city', 'City'],
  ['address_state', 'Address state'],
  ['address_zip', 'ZIP'],
  ['drivers_license_number', "Driver's license #"],
  ['draft_day', 'Draft day'],
  ['bank_name', 'Bank name'],
  ['routing_number', 'Routing number'],
  ['account_number', 'Account number'],
  ['current_carrier', 'Current carrier being replaced'],
]

// Prompt 423 — beneficiaries: at least one required, name + a constrained
// relationship dropdown (Other included so nobody's boxed out).
const BLANK_BENEFICIARY = { name: '', relationship: '' }
const RELATIONSHIP_OPTIONS = [
  { value: 'Spouse', label: 'Spouse' },
  { value: 'Child', label: 'Child' },
  { value: 'Parent', label: 'Parent' },
  { value: 'Sibling', label: 'Sibling' },
  { value: 'Other', label: 'Other' },
]

// Brayden's own framing: callback bookings should default to today or
// tomorrow — "if we're booked out, then we're booked out" is the exception,
// not the norm. Far out here means the day after tomorrow or later.
function isFarOut(localDateTimeValue) {
  if (!localDateTimeValue) return false
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + 2)
  cutoff.setHours(0, 0, 0, 0)
  return new Date(localDateTimeValue) >= cutoff
}

function NewSubmission() {
  const { profile } = useAuth()
  const { data: carriers = [] } = useCarriers()
  const { data: commissionRows = [] } = useCommissionSchedule()
  const create = useCreatePolicy()
  const createDetails = useCreateFulfillmentDetails()
  const [form, setForm] = useState(BLANK)
  const [details, setDetails] = useState(BLANK_DETAILS)
  // Prompt 423 — one or more { name, relationship } rows (migration 105).
  const [beneficiaries, setBeneficiaries] = useState([{ ...BLANK_BENEFICIARY }])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)
  // Prompt 419 — soft (not hard-blocking) confirm gate for a callback time
  // more than a day out. showFarOutConfirm surfaces the inline prompt;
  // confirmFarOut is the agent's explicit "yes, that's right" — cleared any
  // time the callback time itself changes, so a new far-out pick needs its
  // own confirm.
  const [showFarOutConfirm, setShowFarOutConfirm] = useState(false)
  const [confirmFarOut, setConfirmFarOut] = useState(false)
  // Prompt 421 — Callback time is picked the same way Cancellation Calendar
  // books its 3-way call: a date plus one of the fixed hourly SLOTS, not a
  // freeform datetime. These two are the picker's own UI state; the actual
  // value of record stays form.scheduled_call_at (an ISO string), same as
  // before, so validate()/submit()/doSubmit() don't need to change at all.
  const [callbackDate, setCallbackDate] = useState(todayISO())
  const [callbackSlot, setCallbackSlot] = useState('')
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
    if (k === 'scheduled_call_at') {
      setConfirmFarOut(false)
      setShowFarOutConfirm(false)
    }
  }
  // Prompt 421 — recompute form.scheduled_call_at any time either half of
  // the picker changes; a slot picked before a date change re-anchors to
  // the new date automatically instead of silently keeping the old day.
  const pickCallbackDate = d => {
    setCallbackDate(d)
    if (callbackSlot) set('scheduled_call_at', slotToISO(d, callbackSlot))
  }
  const pickCallbackSlot = s => {
    setCallbackSlot(s)
    set('scheduled_call_at', slotToISO(callbackDate, s))
  }
  const setDetail = (k, v) => {
    setDetails(d => ({ ...d, [k]: v }))
    setFieldErrors(errs => {
      if (!errs.has(k)) return errs
      const next = new Set(errs)
      next.delete(k)
      return next
    })
  }
  // Prompt 423 — beneficiary row helpers. Field errors key off
  // `beneficiary_{i}_{field}` so each row highlights independently, same
  // pattern as every other field on this form.
  const setBeneficiary = (i, k, v) => {
    setBeneficiaries(rows => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))
    setFieldErrors(errs => {
      const key = `beneficiary_${i}_${k}`
      if (!errs.has(key)) return errs
      const next = new Set(errs)
      next.delete(key)
      return next
    })
  }
  const addBeneficiary = () => setBeneficiaries(rows => [...rows, { ...BLANK_BENEFICIARY }])
  const removeBeneficiary = i => setBeneficiaries(rows => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows))

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

  // Prompt 401 — every REQUIRED_FIELDS entry plus every DETAILS_REQUIRED_FIELDS
  // entry, since this form is unconditionally the Fulfillment intake now
  // (Prompt 423 — no more toggle, no more self-write branch).
  // Beneficiary rows validate separately since they're an array, not a flat
  // field — at least one row, both fields filled.
  function validate() {
    const missing = REQUIRED_FIELDS.filter(([key]) =>
      key === 'monthly_premium' ? (!form.monthly_premium || monthly <= 0) : !String(form[key] || '').trim()
    )
    missing.push(...DETAILS_REQUIRED_FIELDS.filter(([key]) => !String(details[key] || '').trim()))

    const beneficiaryErrors = new Set()
    beneficiaries.forEach((b, i) => {
      if (!b.name.trim()) beneficiaryErrors.add(`beneficiary_${i}_name`)
      if (!b.relationship) beneficiaryErrors.add(`beneficiary_${i}_relationship`)
    })

    return { missing, beneficiaryErrors }
  }

  // Prompt 419 — split so the far-out confirm button can call doSubmit()
  // directly. Calling submit() again from that button would re-check
  // confirmFarOut against this render's stale closure value (React state
  // updates aren't synchronous), re-triggering the same confirm forever.
  function submit() {
    setError('')
    const { missing, beneficiaryErrors } = validate()
    if (missing.length > 0 || beneficiaryErrors.size > 0) {
      setFieldErrors(new Set([...missing.map(([key]) => key), ...beneficiaryErrors]))
      const labels = missing.map(([, label]) => label)
      if (beneficiaryErrors.size > 0) labels.push('Beneficiaries')
      setError(`Fill in the highlighted field${labels.length > 1 ? 's' : ''} before logging this submission: ${labels.join(', ')}`)
      return
    }
    setFieldErrors(new Set())

    // Prompt 419 — soft scheduling gate: further out than tomorrow needs an
    // explicit "yes, really" before it submits, but never hard-blocks.
    if (isFarOut(form.scheduled_call_at) && !confirmFarOut) {
      setShowFarOutConfirm(true)
      return
    }

    doSubmit()
  }

  async function doSubmit() {
    // Prompt 401 — normalized to title case on submit only, not while typing.
    const firstName = titleCase(form.client_first_name)
    const lastName = titleCase(form.client_last_name)

    try {
      const policy = await create.mutateAsync({
        agent_id: profile.id,
        policy_sold_date: form.policy_sold_date || null,
        // Not knowable yet — Fulfillment hasn't written the policy.
        policy_number: null,
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
        effective_date: null,
        monthly_premium: monthly,
        // No underwriting decision is asked (Fulfillment hasn't written the
        // policy yet, so there's nothing to have a carrier decision on); the
        // ongoing pendingUnderwriting() banner shouldn't fire on the selling
        // agent for a deal they didn't write.
        pending_underwriting: false,
        fulfillment_assigned: true,
        fulfillment_stage: 'Pending',
        scheduled_call_at: form.scheduled_call_at
          ? new Date(form.scheduled_call_at).toISOString()
          : null,
      })

      // Second insert, tied to the policy just created. Not wrapped in a DB
      // transaction (this app doesn't use RPC-wrapped multi-table writes
      // anywhere else) — if this step fails the policy row already exists in
      // the Fulfillment Queue with no intake details yet; the error surfaces
      // below so the agent knows to retry/flag it rather than assume it went
      // through clean.
      // Prompt 423 — full_legal_name is derived from Client First/Last Name
      // (the one place a name is entered now) instead of asking a third time.
      await createDetails.mutateAsync({
        policy_id: policy.id,
        full_legal_name: `${firstName} ${lastName}`,
        date_of_birth: details.date_of_birth || null,
        state_of_birth: details.state_of_birth || null,
        state_of_residence: details.state_of_residence || null,
        email: details.email.trim(),
        height: details.height.trim(),
        weight: details.weight.trim(),
        address_street: details.address_street.trim(),
        address_city: titleCase(details.address_city),
        address_state: details.address_state || null,
        address_zip: details.address_zip.trim(),
        drivers_license_number: details.drivers_license_number.trim(),
        beneficiaries: beneficiaries.map(b => ({ name: titleCase(b.name.trim()), relationship: b.relationship })),
        draft_day: Number(details.draft_day),
        bank_name: details.bank_name.trim(),
        routing_number: details.routing_number.trim(),
        account_number: details.account_number.trim(),
        current_carrier: details.current_carrier.trim(),
      })

      setSaved(`${firstName} ${lastName}${form.carrier_name.trim() ? ` · ${form.carrier_name.trim()}` : ''} · sent to Fulfillment`)
      setForm(BLANK)
      setDetails(BLANK_DETAILS)
      setBeneficiaries([{ ...BLANK_BENEFICIARY }])
      setConfirmFarOut(false)
      setShowFarOutConfirm(false)
      setCallbackDate(todayISO())
      setCallbackSlot('')
    } catch (err) {
      setError(err.message || 'Could not save this submission')
    }
  }

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <p style={cardTitle}>New business submission</p>

      {/* Prompt 423 — every submission routes to Fulfillment now, so this
          script hint (kept from 419) is always shown, not gated on a
          toggle. Brayden doesn't want agents saying "Fulfillment Team" to
          the client; this is the internal team's own name, not a
          client-facing one. */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 18,
        padding: '9px 12px', borderRadius: 6,
        background: 'var(--bg-panel)', border: 'var(--border-w) solid var(--border)',
      }}>
        <MessageCircleMore size={13} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.5 }}>
          Read to the client: "We're going to get you booked with our Underwriting Team to get everything
          squared away."
        </p>
      </div>

      <div style={grid3}>
        <TextField
          label="Policy sold date" type="date" mono
          value={form.policy_sold_date} onChange={e => set('policy_sold_date', e.target.value)}
          error={fieldErrors.has('policy_sold_date')}
        />
        <TextField
          label="Client first name" placeholder="First name"
          value={form.client_first_name} onChange={e => set('client_first_name', e.target.value)}
          error={fieldErrors.has('client_first_name')}
        />
        <TextField
          label="Client last name" placeholder="Last name"
          value={form.client_last_name} onChange={e => set('client_last_name', e.target.value)}
          error={fieldErrors.has('client_last_name')}
        />
      </div>

      <div style={grid3}>
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
      </div>

      {/* Prompt 419 — full Fulfillment intake, everything needed to write
          the replacement policy and cancel the old one. Prompt 423 — no
          longer gated on a toggle (always shown); full_legal_name field
          removed (derived from Client First/Last Name above instead of
          asking a third time).  */}
      <p style={{ margin: '4px 0 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        Fulfillment intake
      </p>

      <div style={grid3}>
        <TextField
          label="Date of birth" type="date" mono
          value={details.date_of_birth} onChange={e => setDetail('date_of_birth', e.target.value)}
          error={fieldErrors.has('date_of_birth')}
        />
        <AnchoredSelectField
          label="State of birth"
          value={details.state_of_birth}
          onChange={val => setDetail('state_of_birth', val)}
          placeholder="Select a state"
          options={US_STATES.map(s => ({ value: s.code, label: s.name }))}
          error={fieldErrors.has('state_of_birth')}
        />
        <AnchoredSelectField
          label="State of residence"
          value={details.state_of_residence}
          onChange={val => setDetail('state_of_residence', val)}
          placeholder="Select a state"
          options={US_STATES.map(s => ({ value: s.code, label: s.name }))}
          error={fieldErrors.has('state_of_residence')}
        />
      </div>

      <div style={grid3}>
        <TextField
          label="Email" type="email" placeholder="client@example.com"
          value={details.email} onChange={e => setDetail('email', e.target.value)}
          error={fieldErrors.has('email')}
        />
        <TextField
          label="Driver's license #" mono
          value={details.drivers_license_number} onChange={e => setDetail('drivers_license_number', e.target.value)}
          error={fieldErrors.has('drivers_license_number')}
        />
        <TextField
          label="Height" placeholder={`5' 10"`}
          value={details.height} onChange={e => setDetail('height', e.target.value)}
          error={fieldErrors.has('height')}
        />
      </div>

      <div style={grid3}>
        <TextField
          label="Weight" placeholder="180 lbs"
          value={details.weight} onChange={e => setDetail('weight', e.target.value)}
          error={fieldErrors.has('weight')}
        />
        <TextField
          label="Draft day" mono type="number" min="1" max="31" placeholder="1–31"
          value={details.draft_day} onChange={e => setDetail('draft_day', e.target.value)}
          error={fieldErrors.has('draft_day')}
        />
        <TextField
          label="Street address"
          value={details.address_street} onChange={e => setDetail('address_street', e.target.value)}
          error={fieldErrors.has('address_street')}
        />
      </div>

      <div style={grid3}>
        <TextField
          label="City"
          value={details.address_city} onChange={e => setDetail('address_city', e.target.value)}
          error={fieldErrors.has('address_city')}
        />
        <AnchoredSelectField
          label="Address state"
          value={details.address_state}
          onChange={val => setDetail('address_state', val)}
          placeholder="Select a state"
          options={US_STATES.map(s => ({ value: s.code, label: s.name }))}
          error={fieldErrors.has('address_state')}
        />
        <TextField
          label="ZIP" mono
          value={details.address_zip} onChange={e => setDetail('address_zip', e.target.value)}
          error={fieldErrors.has('address_zip')}
        />
      </div>

      <div style={grid3}>
        <TextField
          label="Bank name"
          value={details.bank_name} onChange={e => setDetail('bank_name', e.target.value)}
          error={fieldErrors.has('bank_name')}
        />
        <TextField
          label="Routing number" mono
          value={details.routing_number} onChange={e => setDetail('routing_number', e.target.value)}
          error={fieldErrors.has('routing_number')}
        />
        <TextField
          label="Account number" mono
          value={details.account_number} onChange={e => setDetail('account_number', e.target.value)}
          error={fieldErrors.has('account_number')}
        />
      </div>

      {/* Prompt 423 — one or more beneficiaries; relationship is a
          constrained dropdown, not free text (migration 105). */}
      <div style={{ marginBottom: 18 }}>
        <p style={fieldLabel}>Beneficiaries</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {beneficiaries.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Beneficiary name" placeholder="Full name"
                  value={b.name} onChange={e => setBeneficiary(i, 'name', e.target.value)}
                  error={fieldErrors.has(`beneficiary_${i}_name`)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <AnchoredSelectField
                  label="Relationship"
                  value={b.relationship}
                  onChange={val => setBeneficiary(i, 'relationship', val)}
                  placeholder="Select"
                  options={RELATIONSHIP_OPTIONS}
                  error={fieldErrors.has(`beneficiary_${i}_relationship`)}
                />
              </div>
              {beneficiaries.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeBeneficiary(i)}
                  title="Remove beneficiary"
                  style={{ ...ghostBtn, height: 34, padding: '0 10px', flexShrink: 0 }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addBeneficiary}
          style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 11.5, padding: 0, marginTop: 8 }}
        >
          + Add another beneficiary
        </button>
      </div>

      {/* Prominent — this is the one number Fulfillment actually calls
          to cancel the old policy (Brayden: "all you gotta do is call
          up the carrier and say I want to cancel this policy"). */}
      <div style={{
        padding: '12px 14px', marginBottom: 18, borderRadius: 7,
        background: 'var(--warning-dim)', border: '1px solid var(--warning-bd)',
      }}>
        <TextField
          label="Current carrier being replaced" placeholder="Who they're leaving"
          value={details.current_carrier} onChange={e => setDetail('current_carrier', e.target.value)}
          error={fieldErrors.has('current_carrier')}
        />
      </div>

      {/* Prompt 421 — Callback time as a date + fixed-slot picker, same
          pattern as CancellationCalendar below (lib/scheduling.js). Prompt
          423 — moved to the END of the form (was mid-form between Product
          Type and Monthly Premium): gather all client info first, book the
          call last. */}
      <div style={{ marginBottom: 18 }}>
        <p style={fieldLabel}>Callback time</p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <input
            type="date" value={callbackDate} min={todayISO()}
            onChange={e => pickCallbackDate(e.target.value)}
            style={{ ...control, width: 'auto', fontFamily: MONO }}
          />
          <div style={{ flex: 1, minWidth: 280, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {SLOTS.map(s => {
              const on = callbackSlot === s
              return (
                <button
                  key={s} type="button"
                  onClick={() => pickCallbackSlot(s)}
                  style={{
                    height: 34, borderRadius: 6, fontSize: 12, fontWeight: 700,
                    border: `1px solid ${on ? 'var(--accent-border)' : (fieldErrors.has('scheduled_call_at') ? 'var(--danger)' : 'var(--border)')}`,
                    background: on ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                    color: on ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </div>
        <p style={{
          margin: '8px 0 0', fontSize: 10.5, lineHeight: 1.4,
          color: isFarOut(form.scheduled_call_at) ? 'var(--warning)' : 'var(--text-muted)',
        }}>
          Suggested: today or tomorrow — further out needs Fulfillment's OK.
        </p>
        <GapNote>
          Every slot shows as open — there's no shared calendar behind this yet, so nothing here knows
          what else is on your day.
        </GapNote>
      </div>

      {/* Prompt 419 — soft confirm, not a hard block: submit() stops here
          once and waits for an explicit yes before actually saving. */}
      {showFarOutConfirm && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12,
          padding: '11px 14px', borderRadius: 7,
          background: 'var(--warning-dim)', border: '1px solid var(--warning-bd)',
        }}>
          <AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <p style={{ flex: 1, minWidth: 200, margin: 0, fontSize: 12, color: 'var(--text-primary)' }}>
            That's more than a day out — confirm Fulfillment is actually booked through then?
          </p>
          <button
            onClick={() => { setConfirmFarOut(true); setShowFarOutConfirm(false); doSubmit() }}
            style={{ ...ghostBtn, height: 28, background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning-bd)' }}
          >
            Yes, that's correct
          </button>
          <button onClick={() => setShowFarOutConfirm(false)} style={{ ...ghostBtn, height: 28 }}>
            Change time
          </button>
        </div>
      )}

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
        <button
          onClick={submit}
          disabled={create.isPending || createDetails.isPending}
          style={{ ...primaryBtn, opacity: (create.isPending || createDetails.isPending) ? 0.6 : 1 }}
        >
          {(create.isPending || createDetails.isPending) ? 'Logging…' : 'Log Submission'}
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
// SLOTS/slotToISO now live in lib/scheduling.js (Prompt 421) — the
// Fulfillment intake's Callback time picker needs the exact same pattern.

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
