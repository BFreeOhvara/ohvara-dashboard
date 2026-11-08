// GoHighLevel API v2 calls used by ghl-push (Prompt 850). fetch is passed in
// so tests never reach GHL. No Deno APIs, so node --test can load it.
//
// Endpoints (HighLevel API v2, base https://services.leadconnectorhq.com,
// headers Authorization: Bearer <Private Integration token>, Version: 2021-07-28):
//   POST   /contacts/upsert                              Upsert Contact (contacts.write)
//          https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact
//          Tags are NOT sent here: on an existing contact GHL replaces all its
//          tags with the ones sent. Tags go through the two calls below.
//   POST   /contacts/:contactId/tags                     Add Tags (contacts.write)
//          https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags
//   DELETE /contacts/:contactId/tags                     Remove Tags (contacts.write)
//          https://marketplace.gohighlevel.com/docs/ghl/contacts/remove-tags
//   POST   /contacts/:contactId/workflow/:workflowId     Add Contact to Workflow (contacts.write)
//          https://marketplace.gohighlevel.com/docs/ghl/contacts/add-contact-to-workflow
// The token is the Supabase secret GHL_API_KEY: never logged, never returned.

export const GHL_BASE = 'https://services.leadconnectorhq.com'
export const GHL_VERSION = '2021-07-28'

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export class GhlError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
  // A bad or revoked key (401/403): every row would fail, so the batch stops;
  // the rows retry once the key is fixed.
  get auth() { return this.status === 401 || this.status === 403 }
  // Other 4xx (except 408/429) will fail the same way next time.
  get final() { return this.status >= 400 && this.status < 500 && !this.auth && this.status !== 408 && this.status !== 429 }
}

export type ContactInput = {
  locationId: string
  name?: string | null
  phone?: string | null
  email?: string | null
  state?: string | null
  dndSms?: boolean
  customFields?: { key: string; field_value: string }[] // P902: call_outcome fields
}

export function ghlClient(apiKey: string, fetchFn: Fetch) {
  async function call(method: string, path: string, body?: unknown) {
    const res = await fetchFn(`${GHL_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: GHL_VERSION,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (!res.ok) {
      const msg = typeof data?.message === 'string' ? data.message
        : Array.isArray(data?.message) ? data.message.join('; ') : `HTTP ${res.status}`
      throw new GhlError(`GHL ${method} ${path.split('/')[1]}: ${msg}`.slice(0, 300), res.status)
    }
    return data
  }

  return {
    async upsertContact(c: ContactInput): Promise<string> {
      const data = await call('POST', '/contacts/upsert', contactBody(c))
      const id = data?.contact?.id
      if (typeof id !== 'string' || !id) throw new GhlError('GHL upsert returned no contact id', 502)
      return id
    },
    addTags: (contactId: string, tags: string[]) =>
      call('POST', `/contacts/${encodeURIComponent(contactId)}/tags`, { tags }),
    removeTags: (contactId: string, tags: string[]) =>
      call('DELETE', `/contacts/${encodeURIComponent(contactId)}/tags`, { tags }),
    addToWorkflow: (contactId: string, workflowId: string) =>
      call('POST', `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`, {}),
    // P902: a stopped no-answer flow takes the contact out of that workflow.
    removeFromWorkflow: (contactId: string, workflowId: string) =>
      call('DELETE', `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`, {}),
  }
}

export type GhlClient = ReturnType<typeof ghlClient>

// Name split for GHL's first/last fields; the full name goes in `name` too.
export function contactBody(c: ContactInput) {
  const name = (c.name || '').trim().replace(/\s+/g, ' ')
  const [firstName, ...rest] = name ? name.split(' ') : []
  const body: Record<string, unknown> = { locationId: c.locationId, source: 'Ohvara' }
  if (name) {
    body.name = name
    body.firstName = firstName
    if (rest.length) body.lastName = rest.join(' ')
  }
  if (c.phone) body.phone = c.phone
  if (c.email) body.email = c.email
  if (c.state) body.state = c.state
  if (c.dndSms) body.dndSettings = { SMS: { status: 'active', message: 'Opted out in Ohvara' } }
  if (c.customFields?.length) body.customFields = c.customFields
  return body
}
