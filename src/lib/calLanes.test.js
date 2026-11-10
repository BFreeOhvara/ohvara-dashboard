import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calLanes, boxMinutes } from './calLanes.js'

test('P929: two calls 30 minutes apart sit side by side when their boxes would touch', () => {
  const l = calLanes([{ id: 'a', start: 60, end: 120 }, { id: 'b', start: 90, end: 150 }])
  assert.deepEqual(l, { a: [0, 2], b: [1, 2] })
})

test('P929: three close together get three columns; a later free call keeps the full width', () => {
  const l = calLanes([{ id: 'a', start: 0, end: 60 }, { id: 'b', start: 15, end: 75 }, { id: 'c', start: 30, end: 90 }, { id: 'd', start: 200, end: 260 }])
  assert.deepEqual([l.a, l.b, l.c, l.d], [[0, 3], [1, 3], [2, 3], [0, 1]])
})

test('P929: a column frees up once its box ends', () => {
  const l = calLanes([{ id: 'a', start: 0, end: 60 }, { id: 'b', start: 30, end: 90 }, { id: 'c', start: 60, end: 120 }])
  assert.deepEqual([l.a, l.b, l.c], [[0, 2], [1, 2], [0, 2]])
})

test('P929: boxes are at least tall enough to read', () => {
  assert.equal(boxMinutes(30, 58, 1), 58)
  assert.equal(boxMinutes(90, 58, 1), 90)
  assert.equal(boxMinutes(undefined, 58, 0), 60)
})
