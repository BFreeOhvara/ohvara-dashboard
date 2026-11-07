// doc-sign pdf — P886. Fills a carrier form from the policy (doc_templates.fields), writes each signer's typed
// signature in its box, and adds an audit page (who, role, when, IP, device, consent version, the form's SHA-256 before
// signing). pdf-lib, Deno only (the node tests cover core.ts). Deno: `deno check supabase/functions/doc-sign/index.ts`.
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'
import type { Field, Signer } from './core.ts'
import { CONSENT_TEXT, ROLE_WORD, sha256Hex } from './core.ts'

const ascii = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '')

export async function renderPdf(
  base: Uint8Array, fields: Field[], prefill: Record<string, string>,
  meta: { title: string; documentId: string; carrier?: string | null }, signers?: Signer[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(base, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const sig = await doc.embedFont(StandardFonts.HelveticaOblique)
  const pages = doc.getPages()
  const signed = new Map((signers ?? []).filter(s => s.signed_at).map(s => [s.role, s]))
  for (const f of fields) {
    const page = pages[Math.min(Math.max(f.page ?? 0, 0), pages.length - 1)]
    if (f.key.startsWith('sign:')) {
      const s = signed.get(f.key.slice(5))
      if (!s) continue
      page.drawText(ascii(s.signed_name ?? s.name), { x: f.x, y: f.y, size: (f.size ?? 10) + 4, font: sig, color: rgb(0.05, 0.1, 0.35) })
      page.drawText(`Signed electronically ${ascii(String(s.signed_at).slice(0, 10))}`, { x: f.x, y: f.y - 10, size: 6, font })
      continue
    }
    const v = prefill[f.key]
    if (v) page.drawText(ascii(String(v)), { x: f.x, y: f.y, size: f.size ?? 10, font })
  }
  if (!signers) return await doc.save()

  // Audit page: the proof the carrier or a dispute asks for.
  const before = await sha256Hex(base)
  const a = doc.addPage([612, 792])
  let y = 740
  // Wraps by measured width so long lines never overlap the next one.
  const line = (t: string, size = 10, f = font) => {
    let row = ''
    const flush = () => { a.drawText(row, { x: 54, y, size, font: f }); y -= size + 6; row = '' }
    for (const w of ascii(t).split(' ')) {
      const next = row ? `${row} ${w}` : w
      if (row && f.widthOfTextAtSize(next, size) > 504) { flush(); row = w } else row = next
    }
    if (row) flush()
    y -= 2
  }
  line('Electronic signature record', 16)
  line(`Form: ${meta.title}${meta.carrier ? ` (for ${meta.carrier})` : ''}`)
  line(`Document ID: ${meta.documentId}`)
  line(`SHA-256 of the form before signing: ${before}`, 8)
  y -= 6
  for (const s of signers) {
    line(`${ROLE_WORD[s.role] ?? s.role}: ${s.name}`, 11)
    line(`  Typed signature: ${s.signed_name ?? '-'}    Signed: ${s.signed_at ?? '-'} (UTC)`, 9)
    line(`  IP: ${s.ip ?? '-'}    Consent: ${s.consent_version ?? '-'}`, 9)
    line(`  Device: ${(s.ua ?? '-').slice(0, 110)}`, 8)
    y -= 4
  }
  y -= 6
  line('Each signer agreed:', 9)
  line(CONSENT_TEXT, 8)
  line('Signed under the U.S. ESIGN Act and UETA. Links were private to each signer and single-use.', 8)
  return await doc.save()
}
