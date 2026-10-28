import { ChevronRight, Info, Lock, Phone, TriangleAlert } from 'lucide-react'
import { useNow } from '../../lib/agentBookings'
import { BUCKETS, BUCKET_LABEL, BUCKET_EMPTY, bucketCounts, bucketRows, clockText, displayName, rowMeta, splitName } from '../../lib/vaQueue'
import './vaDesk.css'

// The VA queue (mockup: ohvara/mockups/build-the-va-desk-queue-claim-4-item-che.html):
// three count tiles, then Callback due, New and Not reached. Tapping a row
// asks the desk to take it (va_claim). Only rows, names, states, lead type and
// times show here: nothing about a policy.

export function QueueSkeleton() {
  return (
    <div className="va-col" aria-busy="true" aria-label="Loading the queue">
      <div className="va-counts">
        {BUCKETS.map(b => (
          <div key={b} className="ov-card va-count"><p>{BUCKET_LABEL[b]}</p><span className="ov-skel" style={{ display: 'block', width: 40, height: 30, marginTop: 6 }} /></div>
        ))}
      </div>
      <div className="ov-card va-qsec">
        <div className="va-qsec-h"><span className="ov-skel" style={{ display: 'block', width: 110, height: 18 }} /></div>
        {[60, 52, 66].map((w, i) => (
          <div key={i} className="va-skel-row">
            <span className="grow">
              <span className="ov-skel" style={{ display: 'block', width: `${w}%`, height: 15 }} />
              <span className="ov-skel" style={{ display: 'block', width: `${w - 15}%`, height: 12, marginTop: 6 }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function QueueError({ onRetry }) {
  return (
    <div className="ov-card va-empty" role="alert">
      <span className="va-tile err"><TriangleAlert size={20} strokeWidth={2} aria-hidden="true" /></span>
      <h3>We couldn't load the queue</h3>
      <p className="sub">Nothing was changed. Check your connection and try again.</p>
      <button type="button" className="ov-ghost" onClick={onRetry}>Try again</button>
    </div>
  )
}

function Row({ row, now, mine, busy, wait, onTake }) {
  const due = row.bucket === 'callback_due'
  const cls = ['va-qrow', mine && 'mine', wait && 'wait', busy && 'busy'].filter(Boolean).join(' ')
  return (
    <button
      type="button" className={cls} disabled={wait || busy || mine}
      aria-busy={busy || undefined} aria-current={mine ? 'true' : undefined}
      onClick={() => onTake(row)}
    >
      <span className="grow">
        <span className="nm">{displayName(row)}</span>
        <span className="meta">{rowMeta(row, now)}</span>
        {due && row.va_callback_at && <span className="due tab">Call back {clockText(row.va_callback_at, now)}</span>}
      </span>
      {mine ? <span className="va-yours">Yours</span>
        : busy ? <span className="va-claiming">Taking it…</span>
          : <ChevronRight className="chev" size={18} strokeWidth={2} aria-hidden="true" />}
    </button>
  )
}

function Section({ bucket, rows, now, heldId, claimingId, onTake }) {
  const attn = bucket === 'callback_due' && rows.length > 0
  const locked = !!heldId || !!claimingId
  return (
    <section className={attn ? 'ov-attn va-qsec' : 'ov-card va-qsec'} aria-label={BUCKET_LABEL[bucket]}>
      <div className="va-qsec-h"><h2>{BUCKET_LABEL[bucket]}</h2><span className="va-qn tab">{rows.length}</span></div>
      {rows.length === 0
        ? <p className="va-qempty">{BUCKET_EMPTY[bucket]}</p>
        : rows.map(r => (
          <Row
            key={r.lead_id} row={r} now={now}
            mine={r.lead_id === heldId} busy={r.lead_id === claimingId}
            wait={locked && r.lead_id !== heldId && r.lead_id !== claimingId}
            onTake={onTake}
          />
        ))}
    </section>
  )
}

export default function VaQueue({ queue, heldId, claimingId, notice, onTake }) {
  const now = useNow(30e3)
  if (queue.isLoading) return <QueueSkeleton />
  if (queue.isError) return <QueueError onRetry={() => queue.refetch()} />
  const rows = queue.data || []
  const counts = bucketCounts(rows)
  const groups = bucketRows(rows)
  const held = rows.find(r => r.lead_id === heldId)

  return (
    <>
      {held && (
        <p className="ov-note va-qnote"><Lock size={18} strokeWidth={2} aria-hidden="true" />
          <span>Finish or release {splitName(held.contact_name).first || 'this lead'} to take another lead.</span></p>
      )}
      {notice && (
        <p className="ov-note va-qnote" role="status"><Info size={18} strokeWidth={2} aria-hidden="true" /><span>{notice}</span></p>
      )}

      <div className="va-counts">
        {BUCKETS.map(b => (
          <div key={b} className="ov-card va-count"><p>{BUCKET_LABEL[b]}</p><b className="tab">{counts[b]}</b></div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="ov-card va-empty">
          <span className="va-tile"><Phone size={20} strokeWidth={2} aria-hidden="true" /></span>
          <h3>Nothing to work right now</h3>
          <p className="sub">New leads and callbacks show up here on their own. You don't need to refresh.</p>
        </div>
      ) : BUCKETS.map(b => (
        <Section key={b} bucket={b} rows={groups[b]} now={now} heldId={heldId} claimingId={claimingId} onTake={onTake} />
      ))}
    </>
  )
}
