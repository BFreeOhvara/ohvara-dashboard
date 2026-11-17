// P1028: a 40-frame strip of a launch clip, from just before the tap to just after the intro, every frame numbered
// (60 fps frame numbers; frames.mjs checks every frame, this is the picture of it).
//   node scripts/p1028/strip.mjs <clip.mp4> <out.png> [label]
import { spawnSync } from 'node:child_process'

const [clip, out, label = '', secsArg] = process.argv.slice(2)
const SECS = Number(secsArg || 3.6)
const W = 36, H = 80, FPS = 60
const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', clip, '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 }).stdout
const size = W * H * 3, n = Math.floor(raw.length / size)
const mean = f => { let s = 0; const px = raw.subarray(f * size, (f + 1) * size); for (let i = 0; i < px.length; i++) s += px[i]; return s / px.length }
// The tap: the first frame that differs clearly from frame 0 (the home screen).
const m0 = mean(0)
let tap = 0
for (let f = 1; f < n; f++) if (Math.abs(mean(f) - m0) > 6) { tap = f; break }
// The end: the intro has finished (back to a steady app frame), or the clip ends.
const from = Math.max(0, tap - 2), to = Math.min(n - 1, from + Math.round(FPS * SECS))
const step = (to - from) / 39
const picks = Array.from({ length: 40 }, (_, i) => Math.round(from + i * step))
const sel = picks.map(p => `eq(n\\,${p})`).join('+')
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', clip, '-vf',
  `fps=${FPS},select='${sel}',scale=60:-2,tile=40x1:padding=2:color=gray,pad=iw+260:ih:260:0:color=white,` +
  `drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='${label.replace(/[':]/g, ' ')}':x=8:y=(h-th)/2:fontsize=20:fontcolor=black`,
  '-frames:v', '1', out])
if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1) }
console.log(`${label || clip}: tap f${tap}, strip f${picks[0]}..f${picks[39]} (every ~${step.toFixed(1)} frames)`)
