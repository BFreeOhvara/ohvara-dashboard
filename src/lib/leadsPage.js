// P808: the agent Leads page stays hidden until its tables are live and it ships.
// Build-time flag, set only on a local machine (VITE_LEADS_PAGE=1 npm run dev).
// Never set it in any Vercel environment. Off: /agent/leads redirects to
// /agent and no menu, More row or phone title links to it.
export const LEADS_PAGE = import.meta.env.VITE_LEADS_PAGE === '1'

// ?sample=1 feeds made-up leads in memory (src/lib/leadsSample.js). Dev + flag
// only; production builds drop the branch and the fixture with it.
export const leadsSample = () =>
  import.meta.env.DEV && LEADS_PAGE && new URLSearchParams(window.location.search).get('sample') === '1'
