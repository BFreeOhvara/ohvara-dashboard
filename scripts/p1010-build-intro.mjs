// P1010: writes public/intro.js from scripts/p1010-intro.src.js with the mark's paths from ohvara-site/_src/mark.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const mark = JSON.parse(fs.readFileSync(path.resolve(here, '../../ohvara-site/_src/mark.json'), 'utf8'))
const take = (process.argv[2] || '').toUpperCase()
// The first app builds with the navy splash (P1010). Until they exist, 0 keeps the intro off everywhere.
const MIN = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')).ohvara.introMinNativeBuild || { ios: 0, android: 0 }
const MIN_LIGHT = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')).ohvara.introLightMinNativeBuild || { ios: 0, android: 0 }
let src = fs.readFileSync(path.join(here, 'p1010-intro.src.js'), 'utf8')
  .replace('__FRONT__', mark.front).replace('__BACK__', mark.back)
  .replace('__MIN_IOS__', MIN.ios || 'Infinity').replace('__MIN_ANDROID__', MIN.android || 'Infinity')
  .replace('__MIN_LIGHT_IOS__', MIN_LIGHT.ios || 'Infinity').replace('__MIN_LIGHT_ANDROID__', MIN_LIGHT.android || 'Infinity')
if (take) src = src.replace(/var TAKE = '[ABC]'/, `var TAKE = '${take}'`)
fs.writeFileSync(path.resolve(here, '../public/intro.js'), src)
console.log('public/intro.js', src.length, 'bytes', take ? `take ${take}` : '')
