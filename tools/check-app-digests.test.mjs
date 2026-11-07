import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { artifactDigest, digestProblems } from './check-app-digests.mjs'

const app = (version, digest, path = 'example-apps/tasker') => ({ path, name: 'tasker', version, digest })

test('files moving under an unchanged version names the app and how to fix it', () => {
  const [problem, ...rest] = digestProblems({ released: [app('3.0.2', 'a')], head: [app('3.0.2', 'b')], previous: [] })
  assert.equal(rest.length, 0)
  assert.match(problem, /example-apps\/tasker/)
  assert.match(problem, /3\.0\.2/)
  assert.match(problem, /bump/i)
})

test('the same files under the same version are fine', () => {
  assert.deepEqual(digestProblems({ released: [app('3.0.2', 'a')], head: [app('3.0.2', 'a')], previous: [] }), [])
})

test('a bumped app needs the version it replaces in previousVersions', () => {
  const [problem] = digestProblems({ released: [app('3.0.2', 'a')], head: [app('3.0.3', 'b')], previous: [] })
  assert.match(problem, /previousVersions/)
  assert.match(problem, /3\.0\.2/)
  const listed = [{ path: 'example-apps/tasker', version: '3.0.2' }]
  assert.deepEqual(digestProblems({ released: [app('3.0.2', 'a')], head: [app('3.0.3', 'b')], previous: listed }), [])
})

test('an app the release does not hold yet is a fresh install, so nothing to compare', () => {
  assert.deepEqual(digestProblems({ released: [], head: [app('1.0.0', 'b')], previous: [] }), [])
})

test('the digest walks files in name order and skips node_modules', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'digest-'))
  mkdirSync(join(folder, 'dist'))
  mkdirSync(join(folder, 'node_modules'))
  writeFileSync(join(folder, 'package.json'), '{}')
  writeFileSync(join(folder, 'dist', 'a.js'), '1')
  const before = await artifactDigest(folder)
  writeFileSync(join(folder, 'node_modules', 'ignored.js'), 'x')
  assert.equal(await artifactDigest(folder), before)
  writeFileSync(join(folder, 'dist', 'a.js'), '2')
  assert.notEqual(await artifactDigest(folder), before)
})
