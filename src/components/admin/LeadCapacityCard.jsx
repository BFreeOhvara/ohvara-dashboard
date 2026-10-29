import { useEffect, useRef, useState } from 'react'
import { Users, Copy, Check } from 'lucide-react'
import { LoadError } from '../agent/AgentUI'
import { PROPOSAL, asOfLabel, copyText, fmtPerDay, money, typeLabel } from '../../lib/leadCapacity'

// Admin "Lead capacity" card (Overview under the grid, phone Home under This
// week). Presentational: `data` is buildCapacity()'s result, the page passes
// it in from useLeadCapacity, so the card renders from fixtures with no
// network. Read only: the one button copies text to the clipboard.
const SUB = 'Paid-up agents, their daily caps, and the leads going to them'
const TILES = ['Funded agents', 'Daily cap', 'Delivered last week', 'Unassigned now']

function Head({ sub }) {
  return (
    <div className="lc-head">
      <span className="lc-ic" aria-hidden="true"><Users size={19} strokeWidth={2} /></span>
      <div className="lc-grow">
        <h2 className="lc-h">Lead capacity</h2>
        <p className="lc-sub">{sub}</p>
      </div>
    </div>
  )
}

function Tile({ label, n, word, dash, unit, attn, children }) {
  return (
    <div className={`ov-box lc-tile${attn ? ' is-attn' : ''}`}>
      <p className="lc-l">{label}</p>
      <p className={`lc-n${word ? ' is-word' : ''}${dash ? ' is-dash' : ''}`}>{dash ? '—' : n}{unit && !dash && <small>{unit}</small>}</p>
      <p className="lc-s">{children}</p>
    </div>
  )
}

export function LeadCapacityCard({ data, loading, error, onRetry }) {
  const [copied, setCopied] = useState(null) // null | 'ok' | 'fail'
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  if (error && !data) {
    return (
      <section className="ov-card lc" aria-label="Lead capacity">
        <div className="lc-in is-err">
          <Head sub={SUB} />
          <LoadError what="lead capacity" onRetry={onRetry} style={{ gridArea: 'tiles' }} />
        </div>
      </section>
    )
  }

  if (loading || !data) {
    return (
      <section className="ov-card lc" aria-label="Lead capacity" aria-busy="true">
        <div className="lc-in no-foot">
          <Head sub="Checking…" />
          <div className="lc-act">
            <button type="button" className="ov-ghost" disabled><Copy size={16} strokeWidth={2} aria-hidden="true" />Copy for the weekly entry</button>
          </div>
          <div className="lc-tiles">
            {TILES.map(l => (
              <div key={l} className="ov-box lc-tile">
                <p className="lc-l">{l}</p>
                <span className="lc-skel" style={{ width: 56, height: 40 }} />
                <span className="lc-skel" style={{ width: '80%', height: 12 }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  const d = data
  const noPrice = d.threshold == null
  const none = !noPrice && d.funded === 0
  const text = copyText(d)
  const copy = async () => {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setCopied('ok')
      timer.current = setTimeout(() => setCopied(null), 3000)
    } catch {
      setCopied('fail')
    }
  }
  const sub = noPrice ? 'No active lead price' : none ? 'No funded agents yet' : SUB
  const week = <><br />{d.window.label}</>

  return (
    <section className="ov-card lc" aria-label="Lead capacity">
      <div className="lc-in">
        <Head sub={sub} />
        <div className="lc-act">
          <button type="button" className="ov-ghost" onClick={copy} aria-live="polite">
            {copied === 'ok'
              ? <><Check size={16} strokeWidth={2.4} aria-hidden="true" />Copied</>
              : <><Copy size={16} strokeWidth={2} aria-hidden="true" />Copy for the weekly entry</>}
          </button>
          {copied === 'ok' && <p className="lc-done">Paste it into the weekly entry</p>}
          {copied === 'fail' && <p className="lc-done" role="alert">Couldn’t copy. Select the text below instead.</p>}
        </div>

        <div className="lc-tiles">
          {noPrice
            ? <Tile label="Funded agents" n="No price set" word>Funded needs an active lead price; none is guessed</Tile>
            : <Tile label="Funded agents" n={d.funded}>
                {none ? 'No funded agents yet' : <>Leads on, balance at least <span className="lc-mono">{money(d.threshold)}</span></>}
              </Tile>}
          <Tile label="Daily cap" n={d.cap} unit="a day" dash={noPrice}>
            {noPrice ? 'Needs a lead price'
              : none ? 'No funded agents yet'
              : d.noCap ? <><strong>{d.noCap}</strong> funded agent{d.noCap === 1 ? ' has' : 's have'} no cap set</>
              : 'Every funded agent has a cap'}
          </Tile>
          <Tile label="Delivered last week" n={d.delivered} dash={noPrice}>
            {noPrice
              ? <>All agents <strong>{d.deliveredAll}</strong>{week}</>
              : <>{fmtPerDay(d.perDay)} a day · <span className="lc-nw">all agents <strong>{d.deliveredAll}</strong></span>{week}</>}
          </Tile>
          <Tile label="Unassigned now" n={d.unassigned} attn={d.unassigned > 0}>
            {d.unassigned > 0 ? `Typed lead${d.unassigned === 1 ? '' : 's'} waiting for an agent` : 'Nothing waiting'}
          </Tile>
        </div>

        <div className="lc-foot">
          <div className="lc-prices">
            <span className="lc-pl">Lead prices</span>
            {d.prices.length
              ? d.prices.map(p => (
                <span key={p.lead_type} className="lc-price">
                  {typeLabel(p.lead_type)} <b className="lc-mono">{money(p.price_cents)}</b><span className="lc-tag">{PROPOSAL}</span>
                </span>
              ))
              : <span className="lc-price is-none">No active lead price</span>}
          </div>
          <p className="lc-fine">
            Funded means leads switched on and a balance of at least the lowest active price, judged as of now, not as of last week.
            Read only: nothing here talks to Meta or Google or changes a budget. As of {asOfLabel(d.asOf).time}.
          </p>
          {copied === 'fail' && <pre className="ov-box lc-copytext">{text}</pre>}
        </div>
      </div>
    </section>
  )
}
