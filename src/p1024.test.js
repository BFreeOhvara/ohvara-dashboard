// P1024 — names, never emails, everywhere; no filter row in Messages. RUN: node --test src/p1024.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NO_NAME, hasRealName, personName, splitName, joinName } from './lib/personName.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('an email, a blank or the stand-in is never a name', () => {
  assert.equal(hasRealName('Jordan McNutt'), true)
  for (const bad of ['', '  ', null, undefined, 'mcnuttjordan561@gmail.com', NO_NAME]) assert.equal(hasRealName(bad), false, String(bad))
})

test('personName never returns an email', () => {
  assert.equal(personName('mcnuttjordan561@gmail.com'), 'New user')
  assert.equal(personName(null), 'New user')
  assert.equal(personName('mcnuttjordan561@gmail.com', ' Jordan McNutt '), 'Jordan McNutt')
})

test('split and join a full name', () => {
  assert.deepEqual(splitName('Jordan McNutt'), ['Jordan', 'McNutt'])
  assert.deepEqual(splitName('Mary Ann Smith'), ['Mary', 'Ann Smith'])
  assert.deepEqual(splitName('a@b.co'), ['', ''])
  assert.equal(joinName(' Jordan ', ' McNutt '), 'Jordan McNutt')
})

test('the All / Admins / Agents / VAs / Clients row is gone from both admin Messages', () => {
  for (const f of ['./adminshell/screens/Messages.jsx', './adminshell/m/AMsgs.jsx']) {
    const s = src(f)
    assert.doesNotMatch(s, /'Admins'|adm-who-seg|am-seg|setWho/, f)
  }
})

test('no screen falls back to an email for a name', () => {
  assert.doesNotMatch(src('./lib/admReal.js'), /full_name \|\| (p\??\.)?(username|email)/)
  assert.doesNotMatch(src('./components/layout/ShellSwap.jsx'), /full_name \|\| profile\?\.email/)
  assert.doesNotMatch(src('./components/layout/DashboardLayout.jsx'), /\|\| user\.email/)
})

test('Create account and the invite ask for first and last name; an unnamed account gets the prompt', () => {
  for (const f of ['./pages/Join.jsx', './pages/Signup.jsx']) {
    const s = src(f)
    assert.match(s, /label="First name"/, f)
    assert.match(s, /label="Last name"/, f)
    assert.match(s, /joinName\(form\.first, form\.last\)/, f)
  }
  assert.match(src('./components/layout/ProtectedRoute.jsx'), /!hasRealName\(profile\.full_name\)\) return <NamePrompt/)
})

test('migration 283: no email fallback in handle_new_user, Jordan named, other email-names cleared', () => {
  const m = src('../supabase/migrations/283_names_not_emails.sql')
  const fn = m.split('create or replace function public.handle_new_user')[1].split('$function$;')[0]
  assert.doesNotMatch(fn, /,\s*new\.email\s*\)/)
  assert.match(fn, /'New user'/)
  assert.match(m, /'Jordan McNutt'/)
  assert.match(m, /full_name like '%@%'/)
  assert.match(m, /'New user'/)
})
