// P868 — a few expect()-style checks over node:assert for the carrier, phone and Submit tests (npm test runs node --test).
import assert from 'node:assert/strict'

const matches = (v, o) => Object.entries(o).every(([k, x]) => (x && typeof x === 'object' && !Array.isArray(x) ? v?.[k] && matches(v[k], x) : assert.deepEqual(v?.[k], x, k) ?? true))

export function expect(v, msg) {
  return {
    toBe: x => assert.equal(v, x, msg),
    toEqual: x => assert.deepEqual(v, x, msg),
    toBeNull: () => assert.equal(v, null, msg),
    toBeTruthy: () => assert.ok(v, msg),
    toMatch: re => assert.match(String(v), re, msg),
    toHaveLength: n => assert.equal(v.length, n, msg),
    toContain: x => assert.ok(v.includes(x), msg || `expected to contain ${x}`),
    toBeGreaterThan: n => assert.ok(v > n, msg || `${v} > ${n}`),
    toBeGreaterThanOrEqual: n => assert.ok(v >= n, msg || `${v} >= ${n}`),
    toBeLessThan: n => assert.ok(v < n, msg || `${v} < ${n}`),
    toBeLessThanOrEqual: n => assert.ok(v <= n, msg || `${v} <= ${n}`),
    toMatchObject: o => assert.ok(matches(v, o), msg),
    not: { toBeNull: () => assert.notEqual(v, null, msg) },
  }
}
