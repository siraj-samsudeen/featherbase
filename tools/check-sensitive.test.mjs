import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scan, verhoeffValid } from './check-sensitive.mjs'

const kinds = (text, allow) => scan(text, allow).map((f) => f.kind)
// Built at runtime so this file does not itself trip the repository scan.
const MOBILE = ['91234', '56780'].join('')
const CLIENT = ['jeyarama', 'com'].join('.')
const RCT = ['rct', 'in'].join('.')

test('Verhoeff: the published worked example passes, a one-digit change fails', () => {
  assert.equal(verhoeffValid('234123412346'), true)
  assert.equal(verhoeffValid('234123412345'), false)
})

test('a Verhoeff-valid 12-digit number is flagged, spaced or not; an invalid one is not', () => {
  assert.deepEqual(kinds('id 234123412346'), ['aadhaar-like number'])
  assert.deepEqual(kinds('id 2341 2341 2346'), ['aadhaar-like number'])
  assert.deepEqual(kinds('id 234123412345'), [])
  assert.deepEqual(kinds('id 134123412346'), []) // first digit 1 is never issued
  assert.deepEqual(kinds('ts 12345234123412346'), []) // inside a longer digit run
})

test('Indian mobile numbers are flagged with or without a prefix, but not inside longer numbers', () => {
  assert.deepEqual(kinds(`call ${MOBILE}`), ['Indian mobile number'])
  assert.deepEqual(kinds(`call +91 91234 ${'5678'}0`), ['Indian mobile number'])
  assert.deepEqual(kinds(`call 0${MOBILE}`), ['Indian mobile number'])
  assert.deepEqual(kinds('epoch 1700000000'), [])
  assert.deepEqual(kinds(`n 0.${MOBILE}`), [])
  assert.deepEqual(kinds(`n ${MOBILE}1234`), [])
})

test('client-domain emails are flagged case-insensitively; other domains are not', () => {
  assert.deepEqual(kinds(`mail Some.One@${CLIENT.replace('j', 'J')}`), ['client-domain email'])
  assert.deepEqual(kinds(`mail a@x.${RCT}`), ['client-domain email'])
  assert.deepEqual(kinds(`mail a@example.test, b@jeyarama.invalid, c@${CLIENT}.au`), [])
})

test('allowlisted values pass', () => {
  const allow = new Set(['234123412346', MOBILE, `sm.atk@${CLIENT}`])
  assert.deepEqual(kinds(`234123412346 ${MOBILE} SM.ATK@${CLIENT}`, allow), [])
})
