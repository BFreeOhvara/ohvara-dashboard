// Test-only module hooks (node:module register): lets a node:test file import the app's .jsx components.
// Extensionless relative imports resolve to .js / .jsx / index; .jsx compiles with Vite's Oxc transform; .css is empty.
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'

export async function resolve(spec, ctx, next) {
  if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:') && !/\.[cm]?[jt]sx?$|\.css$|\.json$/.test(spec)) {
    const base = fileURLToPath(new URL(spec, ctx.parentURL))
    for (const ext of ['.js', '.jsx', '/index.js', '/index.jsx']) {
      if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true }
    }
  }
  return next(spec, ctx)
}

let oxc
export async function load(url, ctx, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true }
  if (url.endsWith('.jsx')) {
    oxc ||= (await import('vite')).transformWithOxc
    const code = await readFile(fileURLToPath(url), 'utf8')
    const out = await oxc(code, fileURLToPath(url), { lang: 'jsx', jsx: { runtime: 'automatic' } })
    return { format: 'module', source: out.code, shortCircuit: true }
  }
  return next(url, ctx)
}
