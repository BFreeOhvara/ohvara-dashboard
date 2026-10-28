// `npm test` runs every src/**/*.test.js; `npm test -- vaQueue` runs only files whose path contains vaQueue.
import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'

const filters = process.argv.slice(2)
const files = globSync('src/**/*.test.js')
  .map(f => f.replaceAll('\\', '/'))
  .filter(f => !filters.length || filters.some(q => f.includes(q)))
  .sort()

if (!files.length) {
  console.error(`No test files match: ${filters.join(', ') || '(none found)'}`)
  process.exit(1)
}
process.exit(spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' }).status ?? 1)
