// The stretchy pill's maths: edge timing both ways, interrupted flights, the line change rule, label colours.
//   node --test src/lib/stretchPill.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FLIGHT_MS, LEAD_MS, ease, edgesAt, clipOf, flightOffsets, stretchKeyframes, shrinkEdges, sameLine, planMove,
  coverOf, coverTrack, inkAt, parseColor, stackedFills, rememberedEdges,
} from './stretchPill.js'

const A = { top: 3, right: 83, bottom: 35, left: 3 }
const B = { top: 3, right: 150, bottom: 35, left: 86 }
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} vs ${b}`)

test('the curve starts at 0, ends at 1 and only goes up', () => {
  assert.equal(ease(0), 0)
  assert.equal(ease(1), 1)
  let last = 0
  for (let t = 0.02; t < 1; t += 0.02) { const p = ease(t); assert.ok(p > last); last = p }
  // cubic-bezier(0.165, 0.84, 0.44, 1) is a fast start: well past half way by a third of the time.
  assert.ok(ease(0.33) > 0.7)
})

test('moving right: the right edge reaches its target at 360 ms and the left edge at 550 ms', () => {
  close(edgesAt(A, B, LEAD_MS).right, B.right, 'right at 360')
  assert.ok(edgesAt(A, B, LEAD_MS - 40).right < B.right, 'right not there before 360')
  assert.ok(edgesAt(A, B, LEAD_MS).left < B.left - 1, 'left still travelling at 360')
  close(edgesAt(A, B, FLIGHT_MS).left, B.left, 'left at 550')
  assert.ok(edgesAt(A, B, FLIGHT_MS - 40).left < B.left, 'left not there before 550')
})

test('moving left mirrors it: the left edge at 360 ms, the right edge at 550 ms', () => {
  close(edgesAt(B, A, LEAD_MS).left, A.left, 'left at 360')
  assert.ok(edgesAt(B, A, LEAD_MS - 40).left > A.left, 'left not there before 360')
  assert.ok(edgesAt(B, A, LEAD_MS).right > A.right + 1, 'right still travelling at 360')
  close(edgesAt(B, A, FLIGHT_MS).right, A.right, 'right at 550')
  assert.ok(edgesAt(B, A, FLIGHT_MS - 40).right > A.right, 'right not there before 550')
})

test('the pill stretches: mid-flight it is wider than either end and spans part of both buttons', () => {
  const mid = edgesAt(A, B, 200)
  assert.ok(mid.right - mid.left > B.right - B.left)
  assert.ok(mid.left < A.right && mid.right > B.left)
})

test('edges stay put before the start and after the end', () => {
  assert.deepEqual(edgesAt(A, B, 0), A)
  assert.deepEqual(edgesAt(A, B, FLIGHT_MS + 100), B)
})

test('keyframes: about 24 samples, linear offsets from 0 to 1, one exactly on the landing, ending on the target', () => {
  const frames = stretchKeyframes(A, B, 16)
  assert.ok(frames.length >= 24 && frames.length <= 26)
  assert.equal(frames[0].offset, 0)
  assert.equal(frames.at(-1).offset, 1)
  frames.reduce((a, b) => { assert.ok(b.offset > a.offset); return b })
  assert.ok(frames.some(f => f.offset === LEAD_MS / FLIGHT_MS))
  assert.equal(frames[0].clipPath, clipOf(A, 16))
  assert.equal(frames.at(-1).clipPath, clipOf(B, 16))
  assert.equal(clipOf(A, 16), 'inset(3px calc(100% - 83px) calc(100% - 35px) 3px round 16px)')
})

test('an interrupted flight starts from the edges at that elapsed time, with no jump', () => {
  const C = { top: 3, right: 220, bottom: 35, left: 153 }
  const now = edgesAt(A, B, 200)
  const next = planMove(now, C)
  assert.equal(next.fly, true)
  assert.deepEqual(next.from, now)
  assert.equal(stretchKeyframes(next.from, C, 16)[0].clipPath, clipOf(now, 16))
  // The second flight's first moments stay near where the first one was.
  const soon = edgesAt(next.from, C, 16)
  assert.ok(Math.abs(soon.left - now.left) < 12 && soon.left >= now.left)
})

test('turning back mid-flight uses the centre for direction: the left edge leads the way home', () => {
  const now = edgesAt(A, B, 120)
  close(edgesAt(now, A, LEAD_MS).left, A.left)
  assert.ok(edgesAt(now, A, LEAD_MS).right > A.right + 1)
})

test('sameLine: true for same-line rects, false across a wrap', () => {
  const lower = { top: 52, right: 90, bottom: 96, left: 0 }
  assert.equal(sameLine(A, B), true)
  assert.equal(sameLine(A, lower), false)
  // A short chip beside a tall one on the same line: the overlap is measured against the smaller height.
  assert.equal(sameLine({ top: 0, right: 10, bottom: 100, left: 0 }, { top: 40, right: 30, bottom: 60, left: 20 }), true)
  // Touching or barely overlapping lines are different lines.
  assert.equal(sameLine({ top: 0, right: 10, bottom: 44, left: 0 }, { top: 44, right: 10, bottom: 88, left: 0 }), false)
  assert.equal(sameLine({ top: 0, right: 10, bottom: 44, left: 0 }, { top: 22, right: 10, bottom: 66, left: 0 }), false)
  assert.equal(sameLine({ top: 0, right: 10, bottom: 44, left: 0 }, { top: 21, right: 10, bottom: 65, left: 0 }), true)
})

test('line change rule: same-line moves in a wrapped row fly, other-line moves do not', () => {
  const lineOne = { top: 0, right: 80, bottom: 44, left: 0 }
  const lineOneMore = { top: 0, right: 170, bottom: 44, left: 88 }
  const lineTwo = { top: 52, right: 80, bottom: 96, left: 0 }
  assert.equal(planMove(lineOne, lineOneMore).fly, true)
  assert.deepEqual(planMove(lineOne, lineTwo), { fly: false, from: null })
})

test('line change rule: a flight in progress followed by a click on another line does not fly', () => {
  const lineOne = { top: 0, right: 80, bottom: 44, left: 0 }
  const lineOneMore = { top: 0, right: 170, bottom: 44, left: 88 }
  const lineTwo = { top: 52, right: 80, bottom: 96, left: 0 }
  const midFlight = edgesAt(lineOne, lineOneMore, 150)
  assert.deepEqual(planMove(midFlight, lineTwo), { fly: false, from: null })
  assert.equal(planMove(midFlight, lineOneMore).fly, true)
})

test('nothing to fly from or to: no flight', () => {
  assert.equal(planMove(null, A).fly, false)
  assert.equal(planMove(A, null).fly, false)
  assert.equal(planMove(A, A).fly, false)
  assert.equal(planMove({ top: 0, right: 0, bottom: 0, left: 0 }, A).fly, false)
})

test('shrinkEdges pulls every side in, and stays 1 px inside the outer layer all flight', () => {
  const inA = shrinkEdges(A, 1), inB = shrinkEdges(B, 1)
  assert.deepEqual(inA, { top: 4, right: 82, bottom: 34, left: 4 })
  for (const ms of [0, 90, 200, 360, 480, 550]) {
    const out = edgesAt(A, B, ms), inn = edgesAt(inA, inB, ms)
    close(inn.left - out.left, 1, `left at ${ms}`)
    close(out.right - inn.right, 1, `right at ${ms}`)
  }
})

test('a label turns as the pill covers it: the source ends uncovered, the target ends covered', () => {
  const labelA = { left: 30, right: 56 }, labelB = { left: 105, right: 131 }
  const a = coverTrack(A, B, labelA), b = coverTrack(A, B, labelB)
  assert.equal(a[0].cover, 1)
  assert.equal(a.at(-1).cover, 0)
  assert.equal(b[0].cover, 0)
  assert.equal(b.at(-1).cover, 1)
  // Target label is fully under the pill by the time the leading edge lands.
  assert.equal(b.find(f => f.offset === LEAD_MS / FLIGHT_MS).cover, 1)
})

test('a label the pill sweeps past is covered then uncovered', () => {
  const far = { top: 3, right: 300, bottom: 35, left: 240 }
  const track = coverTrack(A, far, { left: 120, right: 140 })
  assert.equal(track[0].cover, 0)
  assert.equal(track.at(-1).cover, 0)
  assert.ok(track.some(f => f.cover === 1))
})

test('an interrupted flight picks up the label colour where it was', () => {
  const label = { left: 105, right: 131 }
  const now = edgesAt(A, B, 60)
  assert.equal(coverTrack(now, A, label)[0].cover, coverOf(now, label))
})

test('coverOf: nothing, part and all', () => {
  assert.equal(coverOf(A, { left: 90, right: 100 }), 0)
  assert.equal(coverOf(A, { left: 73, right: 93 }), 0.5)
  assert.equal(coverOf(A, { left: 10, right: 20 }), 1)
  assert.equal(coverOf(A, { left: 10, right: 10 }), 0)
})

test('inkAt blends the on-pill colour into the off-pill colour, ending exactly on each', () => {
  assert.equal(inkAt('red', 'blue', 0), 'color-mix(in srgb, red 0%, blue)')
  assert.equal(inkAt('red', 'blue', 1), 'color-mix(in srgb, red 100%, blue)')
  assert.equal(inkAt('red', 'blue', 0.5), 'color-mix(in srgb, red 50%, blue)')
  // Barely touched is already well on its way, so a sliver under the edge never matches the pill.
  assert.equal(inkAt('red', 'blue', 0.2), 'color-mix(in srgb, red 39.2%, blue)')
  assert.equal(inkAt('red', 'blue', 0.8), 'color-mix(in srgb, red 60.8%, blue)')
})

test('parseColor reads what getComputedStyle gives back', () => {
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 })
  assert.deepEqual(parseColor('rgba(75, 121, 206, 0.18)'), { r: 75, g: 121, b: 206, a: 0.18 })
  assert.deepEqual(parseColor('color(srgb 1 0 0 / 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 })
  assert.equal(parseColor('oklch(50% 0.1 200)'), null)
})

// Paint a colour over a backdrop, the way the browser stacks the layers.
const over = (top, under) => ['r', 'g', 'b'].map(k => top.a * top[k] + (1 - top.a) * under[k])
const stacked = (a, b, under) => { const [r, g, bl] = over(a, under); return over(b, { r, g, b: bl }) }

test('stackedFills: the middle of a see-through bordered pill looks exactly like the fill alone', () => {
  const pairs = [['rgba(75, 121, 206, 0.18)', 'rgba(255, 255, 255, 0.07)'], ['rgba(10, 31, 68, 0.09)', 'rgba(2, 79, 70, 0.12)']]
  for (const [fill, border] of pairs) {
    const { outer, inner } = stackedFills(fill, border)
    for (const under of [{ r: 20, g: 22, b: 30 }, { r: 246, g: 250, b: 249 }]) {
      const want = over(parseColor(fill), under)
      const got = stacked(parseColor(outer), parseColor(inner), under)
      want.forEach((v, i) => assert.ok(Math.abs(v - got[i]) < 3, `${fill} ${i}: ${v} vs ${got[i]}`))
    }
  }
})

test('stackedFills leaves solid fills and unreadable colours as they are', () => {
  assert.deepEqual(stackedFills('rgb(7, 8, 13)', 'rgba(255, 255, 255, 0.07)'), { outer: 'rgba(255, 255, 255, 0.07)', inner: 'rgb(7, 8, 13)' })
  assert.deepEqual(stackedFills('color-mix(in srgb, red 18%, transparent)', 'red'), { outer: 'red', inner: 'color-mix(in srgb, red 18%, transparent)' })
})

test('rememberedEdges: only a different selection, only within 300 ms', () => {
  const entry = { key: 'clients', edges: A, at: 1000 }
  assert.equal(rememberedEdges(entry, 'pipeline', 1200), A)
  assert.equal(rememberedEdges(entry, 'pipeline', 1300), A)
  assert.equal(rememberedEdges(entry, 'pipeline', 1301), null)
  assert.equal(rememberedEdges(entry, 'clients', 1100), null)
  assert.equal(rememberedEdges(undefined, 'clients', 1100), null)
})

test('offsets are sorted and unique', () => {
  const list = flightOffsets()
  assert.equal(new Set(list).size, list.length)
  assert.deepEqual(list, [...list].sort((a, b) => a - b))
})
