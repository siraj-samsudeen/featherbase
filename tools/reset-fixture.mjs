// Disposable repository and databases for public CLI reset tests. Never use
// an existing database or the checkout's real storage as a fixture.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertLocal } from './dev.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { default: postgres } = createRequire(join(root, 'apps/server/package.json'))('postgres')

export async function resetFixture() {
  const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres')
  assertLocal({ DATABASE_URL: url.toString() })
  assert.equal(url.search, '', 'Reset fixtures require a plain local URL')
  url.pathname = '/postgres'
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const base = mkdtempSync(join(tmpdir(), 'featherbase-reset-'))
  const suffix = randomUUID().replaceAll('-', '')
  const names = [`reset_base_${suffix}`, `reset_named_${suffix}`]
  const urls = names.map((name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString() })
  const clients = []
  const env = { ...process.env, NODE_ENV: 'development', FEATHERBASE_ENV: 'development', FILE_STORAGE_DIR: '', DATABASE_URL: urls[0] }
  for (const folder of ['tools', 'apps/server', 'client-apps/acme/instances/shop', 'client-apps/acme/shop']) mkdirSync(join(base, folder), { recursive: true })
  for (const file of ['dev.mjs', 'featherbase.mjs']) copyFileSync(join(root, 'tools', file), join(base, 'tools', file))
  copyFileSync(join(root, 'apps/server/package.json'), join(base, 'apps/server/package.json'))
  symlinkSync(join(root, 'apps/server/node_modules'), join(base, 'apps/server/node_modules'), 'junction')
  writeFileSync(join(base, 'client-apps/acme/instances/shop/instance.json'), JSON.stringify({ apps: ['client-apps/acme/shop'] }))
  writeFileSync(join(base, 'client-apps/acme/shop/featherbase.json'), JSON.stringify({ name: 'shop' }))
  function run(args, overrides = {}) {
    return spawnSync(process.execPath, [join(base, 'tools/featherbase.mjs'), ...args], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 20000, env: { ...env, ...overrides },
    })
  }
  try {
    for (let i = 0; i < names.length; i++) {
      await admin`create database ${admin(names[i])}`
      const sql = postgres(urls[i], { max: 1, onnotice: () => {} })
      clients.push(sql)
      await sql`create schema featherbase`
      await sql`create table featherbase.internal_metadata (key text primary key, value text)`
      await sql`insert into featherbase.internal_metadata values ('environment', 'development')`
      await sql`create table sentinel (value text)`
      await sql`insert into sentinel values (${i ? 'other-database-kept' : 'selected-database-removed'})`
      await sql.end()
    }
    // Resolve through the public startup environment; assertions below catch
    // a shared default before any destructive command runs.
    const { instanceEnvironment } = await import(`${join(base, 'tools/dev.mjs')}?${suffix}`)
    const before = { ...process.env }
    let stores
    try {
      Object.assign(process.env, env)
      stores = urls.map((databaseUrl) => {
        process.env.DATABASE_URL = databaseUrl
        return instanceEnvironment().FILE_STORAGE_DIR
      })
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]
      Object.assign(process.env, before)
    }
    assert.ok(stores[0], 'local startup must select isolated upload storage')
    assert.notEqual(stores[0], stores[1], 'different databases must not share uploads')
    for (let i = 0; i < stores.length; i++) {
      mkdirSync(join(stores[i], 'public'), { recursive: true })
      for (let n = 0; n <= i; n++) writeFileSync(join(stores[i], 'public', `upload-${n}`), `${i}-${n}`)
    }
    const legacy = join(base, 'apps/server/storage/public/legacy-upload')
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, 'legacy-kept')
    return {
      base, names, urls, stores, admin, run,
      async assertPreserved({ selected = true } = {}) {
        for (let i = selected ? 0 : 1; i < names.length; i++) {
          const sql = postgres(urls[i], { max: 1 })
          try {
            assert.deepEqual(await sql`select value from sentinel`, [{ value: i ? 'other-database-kept' : 'selected-database-removed' }])
          } finally { await sql.end() }
          for (let n = 0; n <= i; n++) assert.equal(readFileSync(join(stores[i], 'public', `upload-${n}`), 'utf8'), `${i}-${n}`)
        }
        assert.equal(readFileSync(legacy, 'utf8'), 'legacy-kept')
      },
      async assertRemoved() {
        assert.equal((await admin`select 1 from pg_database where datname = ${names[0]}`).length, 0)
        assert.equal(existsSync(stores[0]), false)
      },
      connect(index = 0) { return postgres(urls[index], { max: 1, connection: { application_name: 'featherbase-reset-test-server' } }) },
      async close() {
        for (const name of names) await admin`drop database if exists ${admin(name)}`
        await admin.end()
        rmSync(base, { recursive: true, force: true })
      },
    }
  } catch (error) {
    for (const sql of clients) await sql.end().catch(() => {})
    for (const name of names) await admin`drop database if exists ${admin(name)}`
    await admin.end()
    rmSync(base, { recursive: true, force: true })
    throw error
  }
}
