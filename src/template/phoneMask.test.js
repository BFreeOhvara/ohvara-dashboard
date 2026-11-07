import { describe, test } from 'node:test'
import { expect } from '../lib/carriers/testExpect.js'
import { phoneDigits, formatPhone, toE164, phoneComplete, caretAfterDigits, digitsBefore } from './phoneMask.js'
import { typeAheadIndex, STATE_OPTIONS } from './selectOptions.js'

describe('P868 phone mask', () => {
  test('digits only, brackets, space and dash appear by themselves', () => {
    const typed = '5551234567'.split('').reduce((acc, ch) => [...acc, formatPhone(acc[acc.length - 1].replace(/\D/g, '') + ch)], [''])
    expect(typed.slice(1)).toEqual(['(5', '(55', '(555', '(555) 1', '(555) 12', '(555) 123', '(555) 123-4', '(555) 123-45', '(555) 123-456', '(555) 123-4567'])
    expect(formatPhone('abc5x5y5')).toBe('(555')
    expect(formatPhone('')).toBe('')
  })
  test('stops at 10 digits', () => {
    expect(phoneDigits('555123456789')).toBe('5551234567')
    expect(formatPhone('(555) 123-45678')).toBe('(555) 123-4567')
  })
  test('a leading +1 or 1 is stripped, and pasting any format cleans up', () => {
    for (const p of ['+1 (555) 123-4567', '1-555-123-4567', '15551234567', '555.123.4567', ' 555 123 4567 ', '+1 555-123-4567 ext 9']) {
      expect(formatPhone(p), p).toBe('(555) 123-4567')
    }
    expect(phoneDigits('1')).toBe('')
  })
  test('stored as E.164 once complete', () => {
    expect(toE164('(555) 123-4567')).toBe('+15551234567')
    expect(toE164('+15551234567')).toBe('+15551234567')
    expect(toE164('555123')).toBe('')
    expect(phoneComplete('555123456')).toBe(false)
    expect(phoneComplete('5551234567')).toBe(true)
  })
  test('the caret stays after the same digits', () => {
    expect(caretAfterDigits('(555) 123-4567', 3)).toBe(4)
    expect(caretAfterDigits('(555) 123-4567', 4)).toBe(7)
    expect(caretAfterDigits('(555) 123-4567', 10)).toBe(14)
    expect(digitsBefore('+1 (555) 12', 11)).toBe(5)
  })
})

describe('P868 state dropdown', () => {
  test('50 states plus DC', () => {
    expect(STATE_OPTIONS).toHaveLength(51)
    expect(STATE_OPTIONS.map(s => s.value)).toContain('DC')
  })
  const at = (text, from) => STATE_OPTIONS[typeAheadIndex(STATE_OPTIONS, text, from)]?.label
  test('type "T" for Tennessee, again for Texas', () => {
    expect(at('t')).toBe('Tennessee')
    const tn = STATE_OPTIONS.findIndex(s => s.value === 'TN')
    expect(at('t', tn)).toBe('Texas')
    expect(at('tt')).toBe('Texas')
    expect(at('ttt')).toBe('Tennessee')
  })
  test('typing more of the name narrows it', () => {
    expect(at('tex')).toBe('Texas')
    expect(at('new y')).toBe('New York')
    expect(at('w')).toBe('Washington')
    expect(typeAheadIndex(STATE_OPTIONS, 'q')).toBe(-1)
  })
})
