// ?sample=1 feeds made-up leads in memory (src/lib/leadsSample.js). Dev only;
// production builds drop the branch and the fixture with it.
export const leadsSample = () =>
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('sample') === '1'
