// Prompt 781 — the invite link preview. The SPA serves one index.html for
// every route, so link-preview bots (iMessage, Android, Slack) that don't run
// JS would show the same card for every link. This writes dist/join.html: the
// built index.html with invite Open Graph tags (navy + bird image, 1200x630).
// vercel.json sends /join, /join/* and /j/* to it; React Router takes over
// from there exactly as on index.html.
const ORIGIN = 'https://portal.ohvara.com'

const TAGS = [
  ['property', 'og:type', 'website'],
  ['property', 'og:site_name', 'portal.ohvara.com'],
  ['property', 'og:url', `${ORIGIN}/join`],
  ['property', 'og:title', 'You’re invited to Ohvara'],
  ['property', 'og:description', 'Create your Ohvara account. The link works once and expires in 7 days.'],
  ['property', 'og:image', `${ORIGIN}/og/invite.png`],
  ['property', 'og:image:width', '1200'],
  ['property', 'og:image:height', '630'],
  ['property', 'og:image:alt', 'Ohvara: You’re invited'],
  ['name', 'twitter:card', 'summary_large_image'],
  ['name', 'twitter:title', 'You’re invited to Ohvara'],
  ['name', 'twitter:description', 'Create your Ohvara account. The link works once and expires in 7 days.'],
  ['name', 'twitter:image', `${ORIGIN}/og/invite.png`],
]

export function joinOgPage() {
  return {
    name: 'ohvara-join-og',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const index = bundle['index.html']
      if (!index) return
      const html = String(index.source)
        // Drop the page's generic preview tags, then add the invite ones.
        .replace(/\s*<meta (?:property="og:[^"]+"|name="twitter:[^"]+")[^>]*>/g, '')
        .replace('<title>Ohvara Portal</title>', '<title>You’re invited to Ohvara</title>')
        .replace('</head>', `${TAGS.map(([k, n, v]) => `    <meta ${k}="${n}" content="${v}" />`).join('\n')}\n  </head>`)
      this.emitFile({ type: 'asset', fileName: 'join.html', source: html })
    },
  }
}
