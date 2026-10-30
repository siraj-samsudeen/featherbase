import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DevError, assertLocal, listInstances, parseCommand, postgresHelp, resolveInstance } from './dev.mjs'

function repoWith(instanceJson) {
  const base = mkdtempSync(join(tmpdir(), 'dev-test-'))
  const folder = join(base, 'client-apps', 'acme', 'instances', 'shop')
  mkdirSync(folder, { recursive: true })
  mkdirSync(join(base, 'client-apps', 'acme', 'store'), { recursive: true })
  writeFileSync(join(folder, 'instance.json'), JSON.stringify(instanceJson))
  writeFileSync(join(base, 'client-apps', 'acme', 'store', 'featherbase.json'), JSON.stringify({ name: 'store_app' }))
  return base
}

test('an instance declares its apps, by folder', () => {
  const instance = resolveInstance('acme/shop', repoWith({ apps: ['client-apps/acme/store'] }))
  assert.deepEqual(instance.apps.map((a) => a.name), ['store_app'])
})

test('an unknown instance fails naming those that exist', () => {
  const base = repoWith({ apps: ['client-apps/acme/store'] })
  assert.deepEqual(listInstances(base), ['acme/shop'])
  assert.throws(() => resolveInstance('acme/nope', base), /No instance "acme\/nope"\. Name one of: acme\/shop/)
  assert.throws(() => resolveInstance(undefined, base), /Name one of: acme\/shop/)
})

test('an app folder without a manifest is named', () => {
  assert.throws(() => resolveInstance('acme/shop', repoWith({ apps: ['client-apps/acme/missing'] })), /lists client-apps\/acme\/missing/)
})

test('the command line', () => {
  assert.deepEqual(parseCommand(['acme/shop', '--check', '--environment', 'dev']), { instance: 'acme/shop', check: true, environment: 'dev' })
  assert.throws(() => parseCommand(['--nope']), DevError)
})

test('it never leaves development or this machine', () => {
  const local = 'postgres://postgres:postgres@127.0.0.1:5432/x'
  assert.doesNotThrow(() => assertLocal({ DATABASE_URL: local }))
  assert.doesNotThrow(() => assertLocal({ DATABASE_URL: local, NODE_ENV: 'development' }))
  assert.throws(() => assertLocal({ DATABASE_URL: local, NODE_ENV: 'production' }), /development only/)
  assert.throws(() => assertLocal({ DATABASE_URL: local, FEATHERBASE_ENV: 'staging' }), /development only/)
  assert.throws(() => assertLocal({ DATABASE_URL: 'postgres://u:hidden@db.example.com/x' }), (e) => /db\.example\.com/.test(e.message) && !e.message.includes('hidden'))
})

test('help for an unreachable Postgres fits the platform and hides the password', () => {
  const url = 'postgres://postgres:hidden@127.0.0.1:5432/x'
  const refused = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
  assert.match(postgresHelp(refused, url, 'win32'), /Services/)
  assert.match(postgresHelp(refused, url, 'darwin'), /brew services/)
  for (const e of [refused, Object.assign(new Error('no'), { code: '28P01' })]) assert.ok(!postgresHelp(e, url, 'linux').includes('hidden'))
})
