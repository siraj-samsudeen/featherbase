import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { DevError, assertLocal, assertMadeUpDataAllowed, instanceEnvironment, listInstances, localStatus, madeUpSecrets, parseCommand, postgresHelp, resolveInstance, verify } from './dev.mjs'

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

test('a named instance explicitly selects file-managed settings', () => {
  const instance = resolveInstance('acme/shop', repoWith({ apps: ['client-apps/acme/store'] }))
  assert.equal(instanceEnvironment(instance).FEATHERBASE_INSTANCE, 'acme/shop')
})

test('an unknown instance fails naming those that exist', () => {
  const base = repoWith({ apps: ['client-apps/acme/store'] })
  assert.deepEqual(listInstances(base), ['acme/shop'])
  assert.throws(() => resolveInstance('acme/nope', base), /No instance "acme\/nope"\. Name one of: acme\/shop/)
})

test('no instance named selects only Featherbase', () => {
  const base = repoWith({ apps: ['client-apps/acme/store'] })
  const instance = resolveInstance(undefined, base)
  assert.equal(instance.name, 'Featherbase')
  assert.deepEqual(instance.apps, [])
  assert.equal(instance.settingsFile, undefined)
})

test('an app folder without a manifest is named', () => {
  assert.throws(() => resolveInstance('acme/shop', repoWith({ apps: ['client-apps/acme/missing'] })), /lists client-apps\/acme\/missing/)
})

test('the command line', () => {
  assert.deepEqual(parseCommand(['acme/shop', '--check', '--environment', 'dev']), { instance: 'acme/shop', check: true, madeUpData: false, environment: 'dev' })
  assert.equal(parseCommand(['acme/shop', '--made-up-data']).madeUpData, true)
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

test('an instance declares its made-up data, and only a file in this repository', () => {
  const base = repoWith({ apps: ['client-apps/acme/store'], madeUpData: 'client-apps/acme/store/seed.mts' })
  assert.throws(() => resolveInstance('acme/shop', base), /madeUpData names client-apps\/acme\/store\/seed\.mts/)
  writeFileSync(join(base, 'client-apps/acme/store/seed.mts'), '')
  assert.equal(resolveInstance('acme/shop', base).madeUpData, join(base, 'client-apps/acme/store/seed.mts'))
  assert.throws(() => resolveInstance('acme/shop', repoWith({ apps: ['client-apps/acme/store'], madeUpData: '../../outside.mts' })), /not a file in this repository/)
})

test('--made-up-data is local only, and needs an instance that declares it', () => {
  const declares = { name: 'a/b', madeUpData: '/repo/seed.mts' }
  const asked = { madeUpData: true, environment: 'local' }
  assert.doesNotThrow(() => assertMadeUpDataAllowed(asked, declares))
  assert.doesNotThrow(() => assertMadeUpDataAllowed({ madeUpData: false, environment: 'dev' }, { name: 'a/b' }))
  assert.throws(() => assertMadeUpDataAllowed({ ...asked, environment: 'dev' }, declares), /local settings only/)
  assert.throws(() => assertMadeUpDataAllowed(asked, { name: 'a/b' }), /declares no made-up data/)
  // Outside development, or against another machine's database, it stops as every run does.
  assert.throws(() => assertLocal({ DATABASE_URL: 'postgres://u:p@127.0.0.1/x', FEATHERBASE_ENV: 'production' }), /development only/)
})

test('made-up secrets come from what the apps declare, and name no client', () => {
  const secrets = madeUpSecrets([{ secrets: ['SOME_TOKEN'] }, { secrets: [{ name: 'OTHER_KEY', optional: true }] }, { secrets: [] }])
  assert.deepEqual(Object.keys(secrets), ['SOME_TOKEN', 'OTHER_KEY'])
  for (const value of Object.values(secrets)) assert.match(value, /^made-up-local-/)
})

test('the closing lines say what is lacking and the exact next command', () => {
  const instance = { name: 'acme/shop', madeUpData: '/x', apps: [{ name: 'store', title: 'Store' }, { name: 'other', title: 'Other' }] }
  const checks = [{ key: 'app-setup:store', missing: ['secret SOME_TOKEN', 'identifier system crew'] }, { key: 'system-manager-email' }]
  const text = localStatus({ instance, checks }).join('\n')
  assert.match(text, /Store: installed, but NOT set up\. It lacks secret SOME_TOKEN, identifier system crew\./)
  assert.match(text, /Other: installed and set up\./)
  assert.match(text, /pnpm dev acme\/shop --made-up-data/)
  const seeded = localStatus({ instance, checks: [{ key: 'app-setup:store', missing: [] }], madeUpOutput: 'Sign in as a@example.test\n' }).join('\n')
  assert.match(seeded, /Made-up data: yes/)
  assert.match(seeded, /Sign in as a@example\.test/)
  assert.doesNotMatch(seeded, /--made-up-data/)
  assert.match(text, /earlier run stays in the database/)
  const noSeed = localStatus({ instance: { ...instance, madeUpData: undefined }, checks }).join('\n')
  assert.doesNotMatch(noSeed, /--made-up-data/)
  assert.match(noSeed, /\.env\.local/)
})

test('a refused login says how to create it, by platform', () => {
  const refused = (platform) => postgresHelp({ code: '28000' }, 'postgres://postgres:postgres@127.0.0.1:5432/x', platform)
  assert.match(refused('darwin'), /createuser -s postgres/)
  assert.match(refused('linux'), /ALTER USER postgres/)
  assert.match(refused('win32'), /PostgreSQL installer/)
  assert.doesNotMatch(refused('linux'), /postgres:postgres/)
})

// Real HTTP boundary: readiness must distinguish installation from user access.
async function readinessServer(t, { catalog = [], pageStatus = 404, active = true } = {}) {
  const requests = []
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/login') res.end(JSON.stringify({ token: 'readiness-token' }))
    else if (req.headers.authorization !== 'Bearer readiness-token') {
      res.writeHead(401).end('{}')
    } else if (req.url === '/api/apps') res.end(JSON.stringify({ installed: [{ name: 'restricted_app', active }] }))
    else if (req.url === '/api/app_catalog') res.end(JSON.stringify(catalog))
    else if (req.url === '/restricted_app/') res.writeHead(pageStatus).end('{}')
    else res.writeHead(500).end('{}')
  })
  await new Promise((done) => server.listen(0, done))
  t.after(() => new Promise((done) => server.close(done)))
  const port = String(server.address().port)
  return { requests, env: { API_PORT: port, WEB_PORT: port }, instance: { apps: [{ name: 'restricted_app' }] } }
}

test('readiness accepts an active app that requires explicit admission', async (t) => {
  const { instance, env, requests } = await readinessServer(t)
  await verify(instance, env)
  assert.deepEqual(requests, ['POST /api/login', 'GET /api/apps', 'GET /api/app_catalog', 'GET /restricted_app/'])
})

test('readiness still requires a catalog-admitted page to serve', async (t) => {
  const { instance, env } = await readinessServer(t, { catalog: [{ name: 'restricted_app' }], pageStatus: 500 })
  await assert.rejects(verify(instance, env), /HTTP 500; expected a serving page/)
})

test('readiness accepts a catalog-admitted serving page', async (t) => {
  const { instance, env } = await readinessServer(t, { catalog: [{ name: 'restricted_app' }], pageStatus: 200 })
  await verify(instance, env)
})

test('readiness refuses an inactive installation', async (t) => {
  const { instance, env } = await readinessServer(t, { active: false })
  await assert.rejects(verify(instance, env), /installed but not active/)
})

test('readiness refuses a page exposed outside its access catalog', async (t) => {
  const { instance, env } = await readinessServer(t, { pageStatus: 200 })
  await assert.rejects(verify(instance, env), /expected 404 for a user without app access/)
})

test('readiness refuses a failing page outside its access catalog', async (t) => {
  const { instance, env } = await readinessServer(t, { pageStatus: 500 })
  await assert.rejects(verify(instance, env), /HTTP 500; expected 404 for a user without app access/)
})
