// Real quoter, Prompt 328 — InsuranceToolkits.com embedded in place of the
// old ComingSoon placeholder. Brayden's own account (app.insurancetoolkits.com).
// Prompt 329: swapped to the `/fex/lite` URL — `/fex/quoter` redirects to
// landing.insurancetoolkits.com, which sends X-Frame-Options/CSP headers that
// block framing entirely (ERR_BLOCKED_BY_RESPONSE). `/fex/lite` embeds
// correctly, so the "Open in new tab" fallback for frame-busting is no
// longer needed — Brayden asked for it removed.
//
// Prompt 372: the bare URL alone rendered the widget's own UI but showed an
// "Invalid Token" badge and returned no quotes — InsuranceToolkits requires a
// real per-account embed token as a query param, not just the base path.
// Token lives in .env.local (VITE_INSURANCETOOLKITS_EMBED_TOKEN), never
// hardcoded here.
const QUOTER_URL = `https://app.insurancetoolkits.com/fex/lite?token=${import.meta.env.VITE_INSURANCETOOLKITS_EMBED_TOKEN}`

export default function Quoter() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        flex: 1, minHeight: 0,
        background: 'var(--bg-surface)',
        border: 'var(--border-w) solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <iframe
          src={QUOTER_URL}
          title="InsuranceToolkits Quoter"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    </div>
  )
}
