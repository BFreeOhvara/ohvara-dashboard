// P881 — the NIPR lookup: one NPN in, the producer's name and per-state licences out.
//
// NIPR's Producer Database (PDB) is subscriber-only: a customer number and PIN from a NIPR PDB subscription.
// Until those secrets are set the registry reports configured = false and every check goes to a manual
// review (the agent uploads their licence; an admin approves the states). Nothing breaks without it.
//
// The request and the XML shape follow NIPR's PDB XML "Entity Information" report as published to subscribers;
// the parser is deliberately loose (attributes or child elements, either case) so small differences in the real
// response don't break it. CONFIRM against the first real response once the subscription exists.

export type RegLicence = { state: string; active: boolean; life: boolean; expires_on: string | null; number: string | null }
export type RegEntity = { npn: string; first: string | null; last: string | null; name: string | null; licences: RegLicence[] }
export type Lookup =
  | { kind: 'found'; entity: RegEntity }
  | { kind: 'not_found' }
  | { kind: 'down'; reason: string }
export interface Registry { configured: boolean; lookup(npn: string): Promise<Lookup> }

export const PDB_URL = 'https://pdb-services.nipr.com/pdb-xml-reports/entityinfo_xml.cgi'

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
  return m ? m[1].trim() : null
}
const el = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null
}
const blocks = (xml: string, name: string): { open: string; body: string }[] => {
  const out: { open: string; body: string }[] = []
  const re = new RegExp(`(<${name}\\b[^>]*>)([\\s\\S]*?)</${name}>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push({ open: m[1], body: m[2] })
  return out
}
const yes = (v: string | null) => v != null && /^(y|yes|true|active|a)$/i.test(v.trim())

// MM/DD/YYYY or YYYY-MM-DD → YYYY-MM-DD.
export function isoDate(v: string | null): string | null {
  if (!v) return null
  const us = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  const iso = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

// null = no producer in the response (not found, or an error page).
export function parseEntityXml(xml: string, npn: string): RegEntity | null {
  if (!xml || !/<(PRODUCER|INDIVIDUAL|ENTITY_BIOGRAPHIC)\b/i.test(xml)) return null
  const first = el(xml, 'NAME_FIRST'), last = el(xml, 'NAME_LAST')
  const name = [first, el(xml, 'NAME_MIDDLE'), last].filter(Boolean).join(' ') || el(xml, 'NAME') || null
  const licences: RegLicence[] = []
  for (const st of blocks(xml, 'STATE')) {
    const state = (attr(st.open, 'name') || el(st.body, 'STATE_CODE') || '').toUpperCase()
    if (!/^[A-Z]{2}$/.test(state)) continue
    for (const lic of blocks(st.body, 'LICENSE')) {
      const active = yes(attr(lic.open, 'active') ?? el(lic.body, 'ACTIVE') ?? el(lic.body, 'LICENSE_STATUS'))
      const expires = isoDate(attr(lic.open, 'date_expire_license') ?? el(lic.body, 'DATE_EXPIRE_LICENSE'))
      const number = attr(lic.open, 'license_num') ?? el(lic.body, 'LICENSE_NUM')
      // A life line of authority that is itself active (LOA "Life", "Life & Health", "Life, Accident and Health"...).
      const life = blocks(lic.body, 'DETAIL').some(d => {
        const loa = el(d.body, 'LOA') || attr(d.open, 'loa') || ''
        const status = el(d.body, 'LOA_STATUS') ?? el(d.body, 'STATUS') ?? attr(d.open, 'status')
        return /\blife\b/i.test(loa) && (status == null || yes(status))
      })
      licences.push({ state, active, life, expires_on: expires, number })
    }
  }
  return { npn, first, last, name, licences }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export function pdbRegistry(opts: { customer?: string | null; pin?: string | null; url?: string | null; fetch?: Fetch; timeoutMs?: number }): Registry {
  const configured = !!(opts.customer && opts.pin)
  const f: Fetch = opts.fetch ?? ((u, i) => fetch(u, i))
  return {
    configured,
    async lookup(npn) {
      if (!configured) return { kind: 'down', reason: 'no_registry' }
      const u = new URL(opts.url || PDB_URL)
      u.searchParams.set('customer_number', opts.customer!)
      u.searchParams.set('pin_number', opts.pin!)
      u.searchParams.set('report_type', '1')
      u.searchParams.set('id_entity', npn)
      let res: Response
      try {
        res = await f(u.toString(), { signal: AbortSignal.timeout(opts.timeoutMs ?? 15000) })
      } catch (e) {
        return { kind: 'down', reason: `network: ${String((e as Error)?.message ?? e).slice(0, 120)}` }
      }
      if (res.status === 404) return { kind: 'not_found' }
      if (!res.ok) return { kind: 'down', reason: `http ${res.status}` }
      const xml = await res.text()
      // Credentials refused or the service is busy: an outage, never "not found".
      if (/(invalid|unauthori[sz]ed).{0,40}(customer|pin|login|password)|service unavailable/i.test(xml)) return { kind: 'down', reason: 'refused' }
      const entity = parseEntityXml(xml, npn)
      return entity ? { kind: 'found', entity } : { kind: 'not_found' }
    },
  }
}
