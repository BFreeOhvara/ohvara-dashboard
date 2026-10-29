// P808: the agent Leads page stays hidden until its tables are live and it ships.
// Dev-only, build-time flag: it needs a dev server (import.meta.env.DEV) and
// VITE_LEADS_PAGE=1 (VITE_LEADS_PAGE=1 npm run dev, or npm run shots:leads).
// A production build never turns it on, even if the env var leaks into Vercel.
// Off: /agent/leads redirects to /agent, the page is not in the bundle, and no
// menu, More row or phone title links to it.
export const LEADS_PAGE = import.meta.env.DEV && import.meta.env.VITE_LEADS_PAGE === '1'

// ?sample=1 feeds made-up leads in memory (src/lib/leadsSample.js). Dev + flag
// only; production builds drop the branch and the fixture with it.
export const leadsSample = () =>
  import.meta.env.DEV && LEADS_PAGE && new URLSearchParams(window.location.search).get('sample') === '1'
