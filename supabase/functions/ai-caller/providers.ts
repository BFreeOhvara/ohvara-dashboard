// P892 — the voice-AI adapter. One small interface so the AI caller can run on Retell, Vapi or GoHighLevel's Voice AI
// without the rest changing. Nothing is signed up for: with no key the provider is "none" (engine slot "AI caller ·
// not connected yet") and every lead goes to a VA. Request shapes follow each provider's public API (Nov 2026) and
// are checked again when Brayden picks one (see the ship note).
//
// Every provider is turned into the same few events: answered, ended (with why), and tool calls (the AI asking our
// function to check the agent, read times, book, hand off, or stop).

export type EndReason = 'no_answer' | 'voicemail' | 'busy' | 'failed' | 'hangup' | 'transferred' | 'max_duration'
export type Ev =
  | { type: 'answered'; providerCallId: string; callId: string | null; controlUrl?: string | null }
  | { type: 'ended'; providerCallId: string; callId: string | null; reason: EndReason; durationSecs?: number; costCents?: number; summary?: string; transcriptRef?: string
      transferSecs?: number } // P957: how long a live transfer stayed connected to the agent, when the provider says
  | { type: 'transfer_ended'; providerCallId: string; callId: string | null; transferSecs: number }
  | { type: 'tool'; providerCallId: string; callId: string | null; toolCallId: string | null; name: string; args: Record<string, unknown> }

export type StartArgs = {
  callId: string; to: string; from: string; maxSecs: number
  // P916: the provider's own id for the agent's Deedstone number (Vapi), when the number came from the pool.
  fromId?: string | null
  vars: Record<string, string> // first name, agent first name, state, the lead's zone, the draft opening line
}
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>

// P903 — the cold hand-off. say: spoken to the caller first ("connecting you with {agent}"). whisper: played to the
// agent only once they answer, then the caller is connected and the AI leaves. ringSecs: the agent's phone rings this
// long; not answered → the caller stays with the AI (bounceSay), which calls our transfer_failed tool and books.
export type TransferOpts = { say?: string; whisper?: string; ringSecs?: number; bounceSay?: string }

export interface Provider {
  key: 'none' | 'retell' | 'vapi' | 'ghl'
  ready: boolean
  // P903: can the AI keep talking with the caller while a tool call (check_status) is pending? false → a short hold line.
  talksWhileWaiting: boolean
  start(a: StartArgs): Promise<{ providerCallId: string }>
  transfer(providerCallId: string, to: string, controlUrl?: string | null, o?: TransferOpts): Promise<void>
  say(providerCallId: string, words: string, end: boolean, controlUrl?: string | null): Promise<void>
  parse(body: any): Ev | null
  toolReply(toolCallId: string | null, result: unknown): unknown
}

const json = (b: unknown) => JSON.stringify(b)
async function ok(res: Awaited<ReturnType<Fetch>>, what: string) {
  if (!res.ok) throw new Error(`${what} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}
const s = (v: unknown) => (v == null ? '' : String(v))

// ── None: not connected. Starting a call fails, so the lead goes to a VA. ────────────────────────────────────────
export const noProvider = (): Provider => ({
  key: 'none', ready: false, talksWhileWaiting: false,
  async start() { throw new Error('not_connected') },
  async transfer() { throw new Error('not_connected') },
  async say() { throw new Error('not_connected') },
  parse: () => null,
  toolReply: (_id, r) => r,
})

// P957: seconds the transferred caller stayed connected, from Retell's call object (null when it doesn't say).
export function retellTransferSecs(c: any): number | null {
  const end = Number(c?.transfer_end_timestamp), from = Number(c?.end_timestamp)
  if (!Number.isFinite(end) || !Number.isFinite(from) || end <= 0 || from <= 0 || end < from) return null
  return Math.round((end - from) / 1000)
}

// ── Retell ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Outbound: POST /v2/create-phone-call. Webhook events call_started / call_ended / call_analyzed; custom functions
// POST { name, args, call } to our URL and get our JSON back. Transfer: the agent's transfer_call tool reads the
// number from the dynamic variable {{transfer_to}}, which our check_status reply sets. P903: set that tool to warm
// transfer with a private whisper to the agent from {{whisper}}, ring timeout {{ring_secs}}, and on no answer the
// agent resumes and calls transfer_failed (Retell response variables map transfer_to / whisper / ring_secs).
export function retell(key: string, agentId: string, fetchFn: Fetch): Provider {
  const h = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const end: Record<string, EndReason> = {
    dial_no_answer: 'no_answer', voicemail_reached: 'voicemail', dial_busy: 'busy', dial_failed: 'failed', error_unknown: 'failed',
    user_hangup: 'hangup', agent_hangup: 'hangup', call_transfer: 'transferred', max_duration_reached: 'max_duration',
  }
  return {
    key: 'retell', ready: !!key && !!agentId, talksWhileWaiting: true,
    async start(a) {
      const r = await ok(await fetchFn('https://api.retellai.com/v2/create-phone-call', { method: 'POST', headers: h, body: json({
        from_number: a.from, to_number: a.to, override_agent_id: agentId, metadata: { call_id: a.callId },
        retell_llm_dynamic_variables: { ...a.vars, max_secs: String(a.maxSecs) },
      }) }), 'retell start')
      return { providerCallId: s(r.call_id) }
    },
    async transfer() { /* done by the agent's transfer_call tool with {{transfer_to}} */ },
    async say(providerCallId, words, endCall) {
      // Retell speaks through the agent; ending is the end-call endpoint (the words are in the agent prompt).
      if (endCall) await ok(await fetchFn(`https://api.retellai.com/v2/end-call/${encodeURIComponent(providerCallId)}`, { method: 'POST', headers: h, body: json({ reason: words.slice(0, 200) }) }), 'retell end')
    },
    parse(body) {
      const c = body?.call ?? body?.chat ?? {} // a Retell chat (P940 phone-free tests) posts the chat object
      const id = s(c.call_id ?? c.chat_id), callId = s(c.metadata?.call_id) || null
      if (body?.name && body?.args) return { type: 'tool', providerCallId: id, callId, toolCallId: null, name: s(body.name), args: body.args ?? {} }
      if (body?.event === 'call_started') return { type: 'answered', providerCallId: id, callId }
      // P957: the transfer leg's end (Retell 'transfer_ended', or transfer_end_timestamp on the call). Connected time =
      // transfer end - the AI's end. CHECK on the first real transfer (P926 step 4) that these are the fields Retell sends.
      const tSecs = retellTransferSecs(c)
      if (body?.event === 'transfer_ended') return tSecs == null ? null : { type: 'transfer_ended', providerCallId: id, callId, transferSecs: tSecs }
      if (body?.event === 'call_ended' || body?.event === 'call_analyzed') {
        const answered = (c.duration_ms ?? 0) > 0 && !['dial_no_answer', 'voicemail_reached', 'dial_busy', 'dial_failed'].includes(c.disconnection_reason)
        return {
          type: 'ended', providerCallId: id, callId, reason: end[c.disconnection_reason] ?? (answered ? 'hangup' : 'failed'),
          durationSecs: Math.round((c.duration_ms ?? 0) / 1000), costCents: typeof c.call_cost?.combined_cost === 'number' ? c.call_cost.combined_cost : undefined,
          summary: s(c.call_analysis?.call_summary).slice(0, 1200) || undefined, transcriptRef: id || undefined,
          ...(tSecs == null ? {} : { transferSecs: tSecs }),
        }
      }
      return null
    },
    toolReply: (_id, r) => r,
  }
}

// ── Vapi ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Outbound: POST /call. Server messages: status-update, tool-calls, end-of-call-report. Live control (transfer, say)
// goes to the call's monitor.controlUrl.
export function vapi(key: string, assistantId: string, phoneNumberId: string, fetchFn: Fetch): Provider {
  const h = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const end: Record<string, EndReason> = {
    'customer-did-not-answer': 'no_answer', voicemail: 'voicemail', 'customer-busy': 'busy', 'customer-ended-call': 'hangup',
    'assistant-ended-call': 'hangup', 'assistant-forwarded-call': 'transferred', 'exceeded-max-duration': 'max_duration',
  }
  const control = async (url: string | null | undefined, body: unknown) => {
    if (!url) throw new Error('vapi: no control url')
    await ok(await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json(body) }), 'vapi control')
  }
  return {
    key: 'vapi', ready: !!key && !!assistantId && !!phoneNumberId, talksWhileWaiting: true,
    async start(a) {
      const r = await ok(await fetchFn('https://api.vapi.ai/call', { method: 'POST', headers: h, body: json({
        assistantId, phoneNumberId: a.fromId || phoneNumberId, customer: { number: a.to }, metadata: { call_id: a.callId },
        assistantOverrides: { variableValues: a.vars, maxDurationSeconds: a.maxSecs },
      }) }), 'vapi start')
      return { providerCallId: s(r.id) }
    },
    // P903: the whisper is a warm-transfer message the agent hears alone; the AI then leaves (the caller never hears
    // a three-way). fallbackPlan keeps the caller with the assistant when the agent doesn't answer.
    transfer: (_id, to, url, o = {}) => control(url, { type: 'transfer', destination: vapiDestination(to, o) }),
    say: (_id, words, endCall, url) => control(url, { type: 'say', content: words, endCallAfterSpoken: endCall }),
    parse(body) {
      const m = body?.message ?? {}
      const c = m.call ?? {}
      const id = s(c.id), callId = s(c.metadata?.call_id) || null
      if (m.type === 'tool-calls') {
        const t = (m.toolCallList ?? m.toolCalls ?? [])[0]
        if (!t) return null
        const args = typeof t.function?.arguments === 'string' ? JSON.parse(t.function.arguments || '{}') : t.function?.arguments ?? {}
        return { type: 'tool', providerCallId: id, callId, toolCallId: s(t.id) || null, name: s(t.function?.name), args }
      }
      if (m.type === 'status-update' && m.status === 'in-progress') return { type: 'answered', providerCallId: id, callId, controlUrl: s(c.monitor?.controlUrl) || null }
      if (m.type === 'end-of-call-report') {
        return {
          type: 'ended', providerCallId: id, callId, reason: end[m.endedReason] ?? (m.endedReason?.includes('error') ? 'failed' : 'hangup'),
          durationSecs: Math.round(m.durationSeconds ?? 0), costCents: typeof m.cost === 'number' ? Math.round(m.cost * 10000) / 100 : undefined,
          summary: s(m.analysis?.summary ?? m.summary).slice(0, 1200) || undefined, transcriptRef: id || undefined,
        }
      }
      return null
    },
    toolReply: (toolCallId, result) => ({ results: [{ toolCallId, result: typeof result === 'string' ? result : json(result) }] }),
  }
}

export function vapiDestination(to: string, o: TransferOpts = {}) {
  return {
    type: 'number', number: to, ...(o.say ? { message: o.say } : null),
    transferPlan: o.whisper
      ? { mode: 'warm-transfer-say-message', message: o.whisper, timeout: o.ringSecs ?? 20,
          fallbackPlan: { message: o.bounceSay ?? '', endCallEnabled: false } }
      : { mode: 'blind-transfer' },
  }
}

// ── GoHighLevel Voice AI ────────────────────────────────────────────────────────────────────────────────────────
// Outbound Voice AI is started by a GoHighLevel workflow (Jordan's side): we add the contact to the "AI speed to
// lead" workflow through the P850 bridge, and the workflow's webhooks come back here. No live control from our side,
// so a transfer or a hand-off is the workflow's own transfer step to the number we return.
export function ghl(push: ((body: unknown) => Promise<void>) | null, workflowId: string | null): Provider {
  return {
    key: 'ghl', ready: !!push && !!workflowId, talksWhileWaiting: false,
    async start(a) {
      if (!push || !workflowId) throw new Error('not_connected')
      await push({ kind: 'ai_speed_to_lead', workflow_id: workflowId, call_id: a.callId, phone: a.to, vars: a.vars, max_secs: a.maxSecs })
      return { providerCallId: `ghl-${a.callId}` }
    },
    async transfer() { /* the workflow transfers to the number in our tool reply */ },
    async say() { /* the workflow speaks the line in our tool reply */ },
    parse(body) {
      const id = s(body?.call_id ? `ghl-${body.call_id}` : body?.providerCallId), callId = s(body?.call_id) || null
      if (body?.tool) return { type: 'tool', providerCallId: id, callId, toolCallId: null, name: s(body.tool), args: body.args ?? {} }
      if (body?.event === 'answered') return { type: 'answered', providerCallId: id, callId }
      if (body?.event === 'ended') return { type: 'ended', providerCallId: id, callId, reason: (body.reason as EndReason) || 'hangup', durationSecs: Number(body.duration_secs) || 0, summary: s(body.summary).slice(0, 1200) || undefined,
        ...(Number.isFinite(Number(body.transfer_secs)) && body.transfer_secs != null ? { transferSecs: Number(body.transfer_secs) } : {}) }
      return null
    },
    toolReply: (_id, r) => r,
  }
}
