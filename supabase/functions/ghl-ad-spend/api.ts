// GHL Ad Manager reporting call for ghl-ad-spend (Prompt 858). Network only; parsing is core.ts rowsOf.
import { rowsOf, type Report } from './core.ts'

export const GHL_BASE = 'https://services.leadconnectorhq.com'
export const REPORT_PATH = '/ad-publishing/facebook/reporting/list'
export const REPORT_VERSION = 'v3'

export function reportUrl(locationId: string, day: string) {
  const q = new URLSearchParams({ locationId, listType: 'campaigns', startDate: day, endDate: day, type: 'AD_MANAGER' })
  return `${GHL_BASE}${REPORT_PATH}?${q}`
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>
export function ghlReport(fetcher: Fetch) {
  return async (key: string, locationId: string, day: string): Promise<Report> => {
    let res: Response
    try {
      res = await fetcher(reportUrl(locationId, day), { headers: { Authorization: `Bearer ${key}`, Version: REPORT_VERSION, Accept: 'application/json' } })
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : 'network' }
    }
    if (!res.ok) return { ok: false, status: res.status, error: (await res.text().catch(() => '')).slice(0, 200) }
    return { ok: true, rows: rowsOf(await res.json().catch(() => null), day) }
  }
}
