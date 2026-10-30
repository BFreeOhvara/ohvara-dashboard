import { Phone, CalendarDays, Check, CreditCard, CircleAlert, Crown } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useMembershipTiers } from '../../hooks/useMembershipTiers'
import './planV2Parts.css'

// Portal parity T6: what v2's Plan & billing page showed that Billing doesn't, drawn under the old
// Billing page (P719 card style) for every agent. Display only: the membership_tiers rows
// (migration 180) in row order with "Available soon" buttons, which membership the agent is on,
// How it works for Live Calls and Booked Appointments, After a sale and Payment. Nothing here
// calls Stripe or agent-billing; the weekly plan, its Stripe buttons and the lead balance stay in
// BillingPanel above. Styles are .pl2-* in planV2Parts.css.

// What a tier includes, from its product_keys (the row has no list of its own yet). A tier on top
// of Servicing lists "Everything in Servicing" plus what it adds.
const PRODUCT = {
  cancellations: { blurb: 'We cancel your clients’ old policies with the carrier.', items: ['Cancellation calls booked from Clients', 'Fulfillment calls the carrier for you'] },
  servicing: { blurb: 'We keep your policies on the books.', items: ['Everything in Cancellations', 'Packet check and review call', 'Changes, lapse saves and claims help', '12-month chargeback watch'] },
  booked_appointments: { blurb: 'New people booked on your calendar.', items: ['Booked appointments each month', 'Reminders and no-show rebooking'] },
  live_calls: { blurb: 'People who need help now, sent to you live.', items: ['Live transfers from an Ohvara VA', 'Booked on your calendar when you’re away'] },
}
const BASES = ['servicing', 'cancellations']
const BASE_NAME = { servicing: 'Servicing', cancellations: 'Cancellations' }

function tierContents(t) {
  const keys = t.product_keys || []
  const base = BASES.find(k => keys.includes(k))
  const extras = keys.filter(k => !BASES.includes(k) && PRODUCT[k])
  const items = extras.length
    ? [...(base ? [{ text: `Everything in ${BASE_NAME[base]}` }] : []), ...extras.flatMap(k => PRODUCT[k].items.map(text => ({ text, plus: !!base })))]
    : base ? PRODUCT[base].items.map(text => ({ text })) : []
  const blurb = t.description || PRODUCT[extras[extras.length - 1] || base]?.blurb || null
  return { items, blurb, live: keys.includes('live_calls') }
}

const priceText = cents => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 })

const Ico = ({ icon: Icon, size = 18 }) => <Icon size={size} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0 }} />

function Tier({ t, mine }) {
  const { items, blurb, live } = tierContents(t)
  const priced = Number.isInteger(t.price_cents)
  return (
    <article className={`ov-card pl2-card pl2-tier${mine ? ' is-mine' : ''}`} aria-label={t.name}>
      <div className="pl2-tier-top">
        <h3>{t.name}</h3>
        {mine && <span className="pl2-tag"><Crown size={12} strokeWidth={2.4} aria-hidden="true" />Your membership</span>}
      </div>
      {blurb && <p className="pl2-sub">{blurb}</p>}
      <div className="ov-box pl2-price">
        {priced ? <b className="pl2-mono">{priceText(t.price_cents)}</b> : <b>Price set by Ohvara</b>}
        <span>per month, paid upfront</span>
      </div>
      {items.length > 0 && <ul className="pl2-inc">{items.map(i => <li key={i.text} className={i.plus ? 'plus' : undefined}>{i.text}</li>)}</ul>}
      {live && <p className="pl2-must"><Ico icon={CircleAlert} size={16} />You must be active in Ohvara to get live transfers.</p>}
      <button type="button" className="pl2-soon" disabled aria-disabled="true">Available soon</button>
    </article>
  )
}

function Tiers({ query, mineKey }) {
  const { data, isLoading, isError, refetch } = query
  if (isError) {
    return (
      <section className="ov-card pl2-card pl2-empty" role="alert">
        <span className="pl2-tile is-err"><Ico icon={CircleAlert} size={20} /></span>
        <h3>We couldn&rsquo;t load the membership plans</h3>
        <p className="pl2-sub">Try again in a moment.</p>
        <button type="button" className="ov-ghost pl2-btn" onClick={() => refetch()}>Try again</button>
      </section>
    )
  }
  if (isLoading) {
    return (
      <div className="pl2-tiers">
        {[0, 1, 2, 3].map(i => (
          <section key={i} className="ov-card pl2-card pl2-tier" aria-busy="true">
            <span className="pl2-skel" style={{ width: '60%', height: 20 }} />
            <span className="pl2-skel" style={{ width: '100%', height: 56, borderRadius: 14 }} />
            <span className="pl2-skel" style={{ width: '80%', height: 14 }} />
            <span className="pl2-skel" style={{ width: '70%', height: 14 }} />
            <span className="pl2-skel" style={{ width: '100%', height: 44, borderRadius: 999 }} />
          </section>
        ))}
      </div>
    )
  }
  if (!data.length) {
    return (
      <section className="ov-card pl2-card pl2-empty">
        <h3>Membership plans are being set up</h3>
        <p className="pl2-sub">Ohvara is finishing what each plan includes. You can still read how it works below.</p>
      </section>
    )
  }
  return <div className="pl2-tiers">{data.map(t => <Tier key={t.key} t={t} mine={t.key === mineKey} />)}</div>
}

function How({ icon, tone, title, sub, steps, youDo }) {
  return (
    <section className="ov-card pl2-card">
      <div className="pl2-card-head">
        <span className={`pl2-tile ${tone}`}><Ico icon={icon} size={20} /></span>
        <div className="pl2-grow"><h3>{title}</h3><p className="pl2-sub">{sub}</p></div>
      </div>
      <ol className="pl2-steps">{steps.map(s => <li key={s}>{s}</li>)}</ol>
      <div className="ov-box pl2-youdo"><h4>What you do</h4><ul>{youDo.map(s => <li key={s}>{s}</li>)}</ul></div>
    </section>
  )
}

function Note({ icon, title, children }) {
  return (
    <section className="ov-card pl2-card pl2-note">
      <span className="pl2-tile is-a"><Ico icon={icon} size={20} /></span>
      <div className="pl2-grow"><h3>{title}</h3><p className="pl2-sub" style={{ marginTop: 4 }}>{children}</p></div>
    </section>
  )
}

export function PlanV2Parts() {
  const { profile } = useAuth()
  const query = useMembershipTiers()
  const mineKey = profile?.membership_tier || null
  const mine = (query.data || []).find(t => t.key === mineKey)
  return (
    <div className="pl2">
      <section aria-labelledby="pl2-membership" className="pl2-group">
        <div className="pl2-hd">
          <h2 id="pl2-membership">Membership plans</h2>
          <span className="pl2-sub">Paid upfront each month. Prices are set by Ohvara.</span>
        </div>
        {/* "Your plan" from v2 Plan: which membership the agent is on (the weekly plan is the hero above). */}
        {!query.isLoading && !query.isError && (
          <p className="pl2-mine">
            Your membership: <b>{mine ? mine.name : 'None yet'}</b>
            <span className="pl2-dot" aria-hidden="true">·</span>
            <span>Checkout opens once prices are set</span>
          </p>
        )}
        <Tiers query={query} mineKey={mineKey} />
      </section>

      <section aria-labelledby="pl2-how" className="pl2-group">
        <div className="pl2-hd">
          <h2 id="pl2-how">How it works</h2>
          <span className="pl2-sub">What we do with every inbound, and what you do</span>
        </div>
        <div className="pl2-two">
          <How
            icon={Phone} tone="is-b" title="Live Calls" sub="People who already have a policy and want help now"
            steps={[
              'They call in, or pick a time for us to call them.',
              'An Ohvara VA answers and asks a few questions.',
              'If you’re active, the VA transfers the call to you live. Your portal rings and we call your phone.',
              'If you’re not active, the VA books them on your calendar at the first open time within the hour.',
            ]}
            youDo={['Turn on Active when you can take calls. You must be active to get live transfers.', 'Pick up when it rings.', 'Mark each one Sold, Follow up or Not interested.']}
          />
          <How
            icon={CalendarDays} tone="is-a" title="Booked Appointments" sub="Homeowners asking about mortgage protection"
            steps={[
              'They fill in a short form.',
              'An Ohvara VA calls them right away.',
              'They’re booked on your calendar.',
              'They get a confirmation, a reminder the day before and one an hour before, each with a link to move the time.',
              'If they don’t show, the VA rebooks them within the hour, up to twice.',
              'If we can’t reach them, we call or text on day 0, 1, 3 and 7, then once a month. We stop when they reply, book or ask us to stop.',
            ]}
            youDo={['Show up at the booked time.', 'Mark each one Sold, Follow up or Not interested.']}
          />
        </div>
      </section>

      <div className="pl2-two">
        <Note icon={Check} title="After a sale">
          Mark it Sold and they become your client. Servicing starts on its own: we check the policy packet, book a review call and watch for chargebacks for 12 months.
        </Note>
        {/* On v2 Plan this read "Nothing is charged today"; here the weekly plan above is charged, so it names the membership. */}
        <Note icon={CreditCard} title="Membership payment">
          You&rsquo;ll pay for your membership upfront each month. Checkout for it opens here once Ohvara sets the prices. Nothing is charged for a membership today.
        </Note>
      </div>
    </div>
  )
}
