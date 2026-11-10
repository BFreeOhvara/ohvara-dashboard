// P932 — the three included hold-music tracks (public/hold/*.mp3), made here from scratch so they're ours: no
// samples, no copyrighted melody, nothing to license. Each is a seamless 20-second loop (soft pad, bass and a bell
// arpeggio over four chords) at phone quality; Twilio <Play loop> repeats it. Needs ffmpeg on PATH.
//   node scripts/p932-hold-music.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const RATE = 22050, LEN = 20, N = RATE * LEN
const hz = m => 440 * 2 ** ((m - 69) / 12)
const TRACKS = {
  calm: { chords: [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]], step: 0.625, bell: 0.16, bright: 1 },
  warm: { chords: [[50, 57, 61, 66], [47, 54, 57, 62], [43, 50, 54, 59], [45, 52, 57, 61]], step: 0.5, bell: 0.14, bright: 0.8 },
  bright: { chords: [[53, 60, 64, 69], [52, 60, 64, 67], [50, 57, 60, 65], [46, 53, 58, 62]], step: 0.3125, bell: 0.12, bright: 1.6 },
}

function render({ chords, step, bell, bright }) {
  const out = new Float64Array(N)
  const add = (t0, dur, f, amp, shape) => {
    const a = Math.floor(t0 * RATE), n = Math.floor(dur * RATE)
    for (let i = 0; i < n; i++) {
      const t = i / RATE
      out[(a + i) % N] += amp * shape(t, dur) * Math.sin(2 * Math.PI * f * t)
    }
  }
  const pad = (t, d) => Math.min(t / 0.8, 1) * Math.min(Math.max((d - t) / 1.4, 0), 1)
  const pluck = t => Math.exp(-t * (3 / bright)) * Math.min(t / 0.005, 1)
  const bar = LEN / chords.length
  chords.forEach((ch, k) => {
    const t0 = k * bar
    for (const m of ch.slice(1)) for (const det of [-0.12, 0.12]) add(t0, bar + 1.2, hz(m + 12) * 2 ** (det / 12), 0.045, pad)
    add(t0, bar + 1.2, hz(ch[0] - 12), 0.11, pad)
    const notes = [...ch.slice(1), ch[1] + 12, ...ch.slice(1).reverse()]
    for (let s = 0, j = 0; s < bar - 0.01; s += step, j++) {
      const m = notes[j % notes.length] + 24
      add(t0 + s, 2.2, hz(m), bell, pluck)
      add(t0 + s, 1.2, hz(m) * 2, bell * 0.25 * bright, pluck)
    }
  })
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  const pcm = Buffer.alloc(N * 2)
  for (let i = 0; i < N; i++) pcm.writeInt16LE(Math.round((out[i] / peak) * 0.7 * 32767), i * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(RATE, 24)
  head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([head, pcm])
}

mkdirSync('public/hold', { recursive: true })
for (const [name, spec] of Object.entries(TRACKS)) {
  const wav = `public/hold/${name}.wav`
  writeFileSync(wav, render(spec))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '22050', '-b:a', '48k', `public/hold/${name}.mp3`])
  rmSync(wav)
  console.log(`public/hold/${name}.mp3`)
}
