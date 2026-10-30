import { createServer } from 'vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'

const mock = `
const rpc = (...a) => globalThis.__rpc(...a)
const deep = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : deep()), apply: () => deep() })
export const supabase = { rpc, auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) }, from: () => deep(), channel: () => deep(), removeChannel() {} }
export default supabase
`
const plug = {
  name: 'duty-scratch',
  enforce: 'pre',
  resolveId(id) { if (/(^|\/)supabase(\.js)?$/.test(id)) return '\0mock-supabase' },
  load(id) { if (id === '\0mock-supabase') return mock },
  transform(code, id) { if (id.endsWith('pages/admin/Users.jsx')) return code + '\nexport { OnDutyCard }\n' },
}
const server = await createServer({ configFile: false, root: process.cwd(), plugins: [(await import('@vitejs/plugin-react')).default(), plug], server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } })
const { OnDutyCard } = await server.ssrLoadModule('/src/pages/admin/Users.jsx')

async function run(label, rpc) {
  globalThis.__rpc = async () => rpc
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  const el = () => h(QueryClientProvider, { client }, h(OnDutyCard))
  renderToString(el())
  await client.getQueryCache().find({ queryKey: ['on-duty-agents'] }).fetch().catch(() => {})
  const html = renderToString(el())
  const text = html.replace(/<[^>]+>/g, '|').replace(/\|+/g, ' | ')
  console.log(`--- ${label}\n${text}`)
}
await run('2 rows', { data: [
  { agent_id: '1', full_name: 'A B', since: '2026-10-30T20:15:00Z' },
  { agent_id: '2', full_name: 'C D', since: null }], error: null })
await run('empty', { data: [], error: null })
await run('missing fn 42883', { data: null, error: { code: '42883', message: 'function does not exist' } })
await run('missing fn PGRST202', { data: null, error: { code: 'PGRST202', message: 'x' } })
await server.close()
