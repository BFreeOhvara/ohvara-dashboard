// P1010: writes public/intro.js from scripts/p1010-intro.src.js with the mark's paths from ohvara-site/_src/mark.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const mark = JSON.parse(fs.readFileSync(path.resolve(here, '../../ohvara-site/_src/mark.json'), 'utf8'))
const take = (process.argv[2] || '').toUpperCase()
let src = fs.readFileSync(path.join(here, 'p1010-intro.src.js'), 'utf8')
  .replace('__FRONT__', mark.front).replace('__BACK__', mark.back)
if (take) src = src.replace("var TAKE = 'A'", `var TAKE = '${take}'`)
fs.writeFileSync(path.resolve(here, '../public/intro.js'), src)
console.log('public/intro.js', src.length, 'bytes', take ? `take ${take}` : '')
