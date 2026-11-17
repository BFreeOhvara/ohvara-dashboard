// P1028: download a Codemagic build's artefacts (and print its step results).
//   node scripts/p1028/cm-artifacts.mjs <buildId> <outdir>
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })
const [id, out] = process.argv.slice(2)
const token = process.env.CODEMAGIC_API_TOKEN
const H = { 'x-auth-token': token }
const { build } = await (await fetch(`https://api.codemagic.io/builds/${id}`, { headers: H })).json()
console.log(build.status, (build.buildActions || []).map(a => `${a.name}:${a.status}`).join(' | '))
fs.mkdirSync(out, { recursive: true })
for (const a of build.artefacts || []) {
  const res = await fetch(a.url, { headers: H })
  const file = path.join(out, a.name)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  console.log(file, fs.statSync(file).size)
}
