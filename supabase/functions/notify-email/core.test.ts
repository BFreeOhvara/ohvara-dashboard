/**
 * Node unit tests for the notification email sender (Prompt 767). Resend is
 * mocked: no real email leaves.
 * Run: node --test supabase/functions/notify-email/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, sendDue, buildMail, type Store, type Due, type Mail } from './core.ts'

const SECRET = 's3cret'
const APP = 'https://portal.ohvara.com'
const due = (o: Partial<Due> = {}): Due => ({
  id: crypto.randomUUID(), to_email: 'brayden@example.com', to_name: 'Brayden',
  subject: 'Monday’s payout is $120 short', body: 'Stripe has $160 and the run needs $280.', link: '/admin/payouts', type: 'payout_problem', ...o,
})

function memStore(rows: Due[]) {
  const finished: { id: string; ok: boolean; error?: string }[] = []
  let claimed = false
  const store: Store = {
    async cronOk(s) { return s === SECRET },
    async claim() { if (claimed) return []; claimed = true; return rows },
    async finish(id, ok, error) { finished.push({ id, ok, error }) },
  }
  return { store, finished }
}
const req = (secret?: string, method = 'POST') =>
  new Request('https://x/functions/v1/notify-email', { method, headers: secret ? { 'x-ohvara-cron': secret } : {} })

test('refuses without the cron secret, and with a wrong one', async () => {
  const { store } = memStore([due()])
  const sent: Mail[] = []
  assert.equal((await handle(req(), store, async m => { sent.push(m) }, { appUrl: APP })).status, 403)
  assert.equal((await handle(req('nope'), store, async m => { sent.push(m) }, { appUrl: APP })).status, 403)
  assert.equal(sent.length, 0)
})

test('sends each due email once and marks it sent', async () => {
  const rows = [due(), due({ to_email: 'rep@example.com', subject: 'Paid $230', link: '/fulfillment/pay' })]
  const { store, finished } = memStore(rows)
  const sent: Mail[] = []
  const res = await handle(req(SECRET), store, async m => { sent.push(m) }, { appUrl: APP })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { configured: true, claimed: 2, sent: 2, failed: 0 })
  assert.deepEqual(sent.map(m => m.to), ['brayden@example.com', 'rep@example.com'])
  assert.ok(finished.every(f => f.ok))
  // a second call finds nothing left
  assert.deepEqual(await sendDue(store, async m => { sent.push(m) }, APP), { claimed: 0, sent: 0, failed: 0 })
  assert.equal(sent.length, 2)
})

test('a Resend failure is recorded for retry, others still go', async () => {
  const rows = [due({ to_email: 'bad@example.com' }), due()]
  const { store, finished } = memStore(rows)
  const out = await sendDue(store, async m => { if (m.to === 'bad@example.com') throw new Error('resend 422') }, APP)
  assert.deepEqual(out, { claimed: 2, sent: 1, failed: 1 })
  assert.equal(finished[0].ok, false)
  assert.equal(finished[0].error, 'resend 422')
  assert.equal(finished[1].ok, true)
})

test('no address → failed, nothing sent', async () => {
  const { store, finished } = memStore([due({ to_email: null })])
  const sent: Mail[] = []
  await sendDue(store, async m => { sent.push(m) }, APP)
  assert.equal(sent.length, 0)
  assert.equal(finished[0].error, 'No email address')
})

test('not configured → leaves the queue alone', async () => {
  const { store, finished } = memStore([due()])
  const res = await handle(req(SECRET), store, null, { appUrl: APP })
  assert.deepEqual(await res.json(), { configured: false, sent: 0 })
  assert.equal(finished.length, 0)
})

test('the email escapes text and links into the portal', () => {
  const m = buildMail(due({ subject: 'A <b>job</b> failed', body: 'line one\n- "two" & three', link: '/admin' }), APP)
  assert.ok(m.html.includes('A &lt;b&gt;job&lt;/b&gt; failed'))
  assert.ok(m.html.includes('&quot;two&quot; &amp; three'))
  assert.ok(m.html.includes('href="https://portal.ohvara.com/admin"'))
  assert.ok(m.text.includes('https://portal.ohvara.com/admin'))
  // an outside link is never used
  assert.ok(buildMail(due({ link: 'https://evil.example' }), APP).text.includes(`${APP}/\n`))
})
