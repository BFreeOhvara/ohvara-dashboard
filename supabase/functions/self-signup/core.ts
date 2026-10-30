// self-signup — the logic, kept free of Supabase/Deno imports so it can be
// exercised with fakes (index.ts wires the real database, env and auth).
//
// A public door, so it defends itself: closed unless app_settings says open or
// the email is on the test list, rate limited, and it never says whether an
// email already has an account. The role is always 'agent'; nothing in the
// request can change it, and an account made here has no upline.

export const ROLE = 'agent'
// Which terms the person agreed to. Stamped on the account; the text lives elsewhere.
export const TERMS_VERSION = '2026-10-30'

export const IP_LIMIT = 5
export const EMAIL_LIMIT = 3
const HOUR_MS = 3600e3
// Every "ok" takes at least this long. A new account does more work than a
// repeat email, and the time it takes must not give that away.
export const MIN_OK_MS = 2500

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALREADY_REGISTERED = /already.*(registered|exists)/i

export const MSG = {
  closed: "Sign-ups aren't open yet.",
  name: 'Enter your name',
  email: 'Enter a valid email address',
  password: 'Password must be 8 to 72 characters with a number',
  terms: 'Agree to the terms to continue',
  tooMany: 'Too many tries. Try again in an hour.',
  failed: "Couldn't create your account. Try a different password, or try again later.",
}

export type Account = {
  id: string
  signup_source: string | null
  email_confirm_pending: boolean | null
  is_active: boolean | null
}

export type PendingSignup = {
  email: string; role: typeof ROLE; source: 'self'
  terms_version: string; terms_accepted_at: string; created_at: string
}

export type NewUser = {
  email: string; password: string; email_confirm: true
  app_metadata: { role: typeof ROLE }; user_metadata: { full_name: string }
}

export type Deps = {
  // SELF_SIGNUP_TEST_EMAILS: comma-separated, empty by default.
  testEmails: string
  signupOpen(): Promise<boolean>
  hash(value: string): Promise<string>
  countAttempts(column: 'ip_hash' | 'email_hash', hash: string, since: string): Promise<number>
  recordAttempt(ipHash: string, emailHash: string, at: string): Promise<void>
  // The live account with this email, if any.
  findAccount(email: string): Promise<Account | null>
  isLocked(userId: string): Promise<boolean>
  savePending(row: PendingSignup): Promise<void>
  clearPending(email: string): Promise<void>
  createUser(user: NewUser): Promise<{ id: string | null; error: { code?: string; status?: number; message?: string } | null }>
  markConfirmPending(userId: string): Promise<void>
  sendConfirm(userId: string, email: string): Promise<boolean>
  now(): Date
  sleep(ms: number): Promise<void>
  log(msg: string): void
}

export type Result = { status: number; body: Record<string, unknown> }

// The one answer to a sign-up that went through, whoever's email it was.
const OK: Result = { status: 200, body: { ok: true } }

export function onTestList(raw: string, email: string) {
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean).includes(email)
}

async function isOpen(deps: Deps) {
  try {
    return (await deps.signupOpen()) === true
  } catch (err) {
    deps.log(`settings read failed: ${err instanceof Error ? err.message : 'error'}`)
    return false
  }
}

function invalid(body: Record<string, unknown>, fullName: string, email: string): string | null {
  if (!fullName || fullName.length > 120) return MSG.name
  // @ohvara.internal is the old synthetic address: nothing can be mailed to it.
  if (email.length > 254 || !EMAIL_RE.test(email) || email.endsWith('@ohvara.internal')) return MSG.email
  const pw = body.password
  if (typeof pw !== 'string' || pw.length < 8 || !/\d/.test(pw) || new TextEncoder().encode(pw).length > 72) return MSG.password
  if (body.agree_terms !== true) return MSG.terms
  return null
}

// 5 per IP and 3 per email in a rolling hour. Over the limit writes nothing.
// Counted again after writing, so a burst of requests at once can't all slip
// through on the first count. Any database error throws, which refuses.
async function overLimit(deps: Deps, ip: string, email: string, now: Date) {
  const [ipHash, emailHash] = await Promise.all([deps.hash(ip), deps.hash(email)])
  const since = new Date(now.getTime() - HOUR_MS).toISOString()
  const over = async (margin: number) => {
    const [byIp, byEmail] = await Promise.all([
      deps.countAttempts('ip_hash', ipHash, since),
      deps.countAttempts('email_hash', emailHash, since),
    ])
    return byIp >= IP_LIMIT + margin || byEmail >= EMAIL_LIMIT + margin
  }
  if (await over(0)) return true
  await deps.recordAttempt(ipHash, emailHash, now.toISOString())
  return await over(1)
}

export async function handle(deps: Deps, ip: string | null, body: Record<string, unknown>): Promise<Result> {
  if (body.action === 'status') return { status: 200, body: { open: await isOpen(deps) } }
  if (body.action !== 'signup') return { status: 400, body: { error: 'Unknown action' } }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!(await isOpen(deps)) && !onTestList(deps.testEmails, email)) {
    return { status: 403, body: { error: MSG.closed } }
  }

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const bad = invalid(body, fullName, email)
  if (bad) return { status: 400, body: { error: bad } }

  const now = deps.now()
  // No address to count against: refused, same as being over the limit.
  if (!ip || await overLimit(deps, ip, email, now)) return { status: 429, body: { error: MSG.tooMany } }

  const ok = async () => {
    const left = MIN_OK_MS - (deps.now().getTime() - now.getTime())
    if (left > 0) await deps.sleep(left)
    return OK
  }

  const account = await deps.findAccount(email)
  if (account) {
    // Only someone still waiting on the confirm link of an unpaid self-signup
    // gets a mail, and it's that same link again. Everyone else: nothing new.
    const waiting = account.signup_source === 'self' && account.email_confirm_pending === true && account.is_active !== false
    if (waiting && await deps.isLocked(account.id)) await confirm(deps, account.id, email)
    return await ok()
  }

  // Written first so handle_new_user stamps signup_source and the terms in the
  // same insert: no later update that could fail and leave the account open.
  await deps.savePending({
    email, role: ROLE, source: 'self', terms_version: TERMS_VERSION,
    terms_accepted_at: now.toISOString(), created_at: now.toISOString(),
  })

  let created: Awaited<ReturnType<Deps['createUser']>>
  try {
    created = await deps.createUser({
      email,
      password: body.password as string,
      email_confirm: true,
      app_metadata: { role: ROLE },
      user_metadata: { full_name: fullName },
    })
  } catch (err) {
    await deps.clearPending(email)
    throw err
  }
  if (created.error || !created.id) {
    await deps.clearPending(email)
    const e = created.error
    // The profile lookup missed it (a race, or an address that differs).
    if (e?.code === 'email_exists' || ALREADY_REGISTERED.test(e?.message ?? '')) return await ok()
    deps.log(`createUser failed: ${e?.status ?? ''} ${e?.code ?? 'error'}`)
    return { status: 500, body: { error: MSG.failed } }
  }

  // Non-fatal, the same as a text invite: the account stands and the banner can
  // resend. Until the link is clicked, account-email still sends a reset to this
  // address (only its real owner reads it), so a stranger can't lock them out.
  try {
    await deps.markConfirmPending(created.id)
    await confirm(deps, created.id, email)
  } catch (err) {
    deps.log(`confirm step failed: ${err instanceof Error ? err.message : 'error'}`)
  }
  return await ok()
}

async function confirm(deps: Deps, userId: string, email: string) {
  try {
    await deps.sendConfirm(userId, email)
  } catch (err) {
    deps.log(`confirm send failed: ${err instanceof Error ? err.name : 'error'}`)
  }
}
