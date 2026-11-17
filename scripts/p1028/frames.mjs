// P1028: frame-by-frame colour timeline of a recording.
//   node scripts/p1028/frames.mjs <clip.mp4> [fps=60]
// Every frame (resampled to a constant fps) is shrunk and sorted into: navy (the splash / intro ground #0A1F44),
// light (mostly near-white: the flash), dark (mostly near-black), or other. Prints runs of the same class.
import { spawnSync } from 'node:child_process'

const [clip, fpsArg] = process.argv.slice(2)
const FPS = Number(fpsArg || 60), W = 36, H = 80
const r = spawnSync('ffmpeg', ['-v', 'error', '-i', clip, '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 })
if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1) }
const buf = r.stdout, size = W * H * 3, n = Math.floor(buf.length / size)

export function classify(px) {
  let navy = 0, light = 0, dark = 0, total = 0
  // Skip the top 6% (status bar icons) and bottom 4% (home bar).
  for (let y = Math.floor(H * 0.06); y < Math.floor(H * 0.96); y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3, R = px[i], G = px[i + 1], B = px[i + 2]
      total++
      if (Math.abs(R - 10) < 14 && Math.abs(G - 31) < 14 && Math.abs(B - 68) < 16) navy++
      const l = 0.2126 * R + 0.7152 * G + 0.0722 * B
      if (l > 195) light++
      else if (l < 40 && !(B > R + 25)) dark++
    }
  }
  if (navy / total > 0.85) return 'navy'
  if (light / total > 0.6) return 'LIGHT'
  if (dark / total > 0.85) return 'dark'
  return 'other'
}

const classes = []
for (let f = 0; f < n; f++) classes.push(classify(buf.subarray(f * size, (f + 1) * size)))
const runs = []
for (let f = 0; f < n; f++) {
  const last = runs[runs.length - 1]
  if (last && last.c === classes[f]) last.n++
  else runs.push({ c: classes[f], from: f, n: 1 })
}
console.log(`${clip}: ${n} frames @${FPS}fps`)
console.log(runs.map(x => `${x.c}×${x.n}(f${x.from})`).join(' → '))
// The launch window: from the first navy frame, the frames until the intro has been on screen 0.5 s.
const firstNavy = classes.indexOf('navy')
if (firstNavy >= 0) {
  const win = classes.slice(firstNavy, firstNavy + Math.round(FPS * 1.2))
  const bad = win.map((c, i) => (c === 'navy' ? null : `f${firstNavy + i}:${c}`)).filter(Boolean)
  console.log(`first 1.2 s from the first navy frame (f${firstNavy}): ${bad.length ? bad.length + ' non-navy: ' + bad.slice(0, 12).join(' ') : 'all navy'}`)
}
