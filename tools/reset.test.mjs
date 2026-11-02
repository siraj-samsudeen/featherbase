import assert from 'node:assert/strict'
import { renameSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { resetFixture } from './reset-fixture.mjs'

test('reset previews the selected database without confirmation', async () => {
  const fixture = await resetFixture()
  try {
    const result = fixture.run(['reset'])
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.ok(result.stdout.includes(fixture.names[0]), result.stdout)
    assert.ok(result.stdout.includes(fixture.stores[0]), result.stdout)
    assert.match(result.stdout, /1 file/)
    assert.match(result.stderr, /--yes/)
    await fixture.assertPreserved()
  } finally { await fixture.close() }
})

test('reset removes only the selected local target', async () => {
  const fixture = await resetFixture()
  try {
    const result = fixture.run(['reset', 'acme/shop', '--yes'])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /Next: featherbase setup/)
    assert.doesNotMatch(result.stdout, /Migrating|Preparing|Installing/)
    await fixture.assertRemoved()
    await fixture.assertPreserved({ selected: false })
  } finally { await fixture.close() }
})

test('reset refuses unsafe targets before changing data', async () => {
  const fixture = await resetFixture()
  try {
    for (const [overrides, message] of [
      [{ DATABASE_URL: 'postgres://u:secret@db.example.com/remote' }, /only uses one on this machine/],
      [{ NODE_ENV: 'production' }, /development only/],
      [{ FEATHERBASE_ENV: 'staging' }, /development only/],
      [{ FILE_STORAGE_DIR: fixture.base }, /storage/i],
      [{ DATABASE_URL: `${fixture.urls[0]}?host=db.example.com` }, /query/i],
    ]) {
      const result = fixture.run(['reset', '--yes'], overrides)
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stderr, message)
      assert.doesNotMatch(result.stderr, /secret/)
      await fixture.assertPreserved()
    }
    for (const stamp of ['production', 'staging', 'test', null]) {
      const sql = fixture.connect()
      try {
        await sql`delete from featherbase.internal_metadata`
        if (stamp) await sql`insert into featherbase.internal_metadata values ('environment', ${stamp})`
      } finally { await sql.end() }
      const result = fixture.run(['reset', '--yes'], { DISABLE_DATABASE_ENVIRONMENT_CHECK: '1' })
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stderr, /recorded as development/)
      await fixture.assertPreserved()
    }
  } finally { await fixture.close() }
})

test('reset names connected processes without killing them', async () => {
  const fixture = await resetFixture()
  const sql = fixture.connect()
  try {
    const [{ pid }] = await sql`select pg_backend_pid() as pid`
    const result = fixture.run(['reset', '--yes'])
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.ok(result.stderr.includes(String(pid)), result.stderr)
    assert.match(result.stderr, /featherbase-reset-test-server/)
    assert.equal((await sql`select pg_backend_pid() as pid`)[0].pid, pid)
    await fixture.assertPreserved()
  } finally { await sql.end(); await fixture.close() }
})

test('reset previews the same default selections as start', async () => {
  const fixture = await resetFixture()
  try {
    const base = fixture.run(['reset'], { DATABASE_URL: '' })
    const named = fixture.run(['reset', 'acme/shop'], { DATABASE_URL: '' })
    assert.equal(base.status, 1)
    assert.equal(named.status, 1)
    assert.match(base.stdout, /database featherbase on/)
    assert.match(named.stdout, /database fb_acme_shop on/)
    assert.notEqual(base.stdout.split('Storage: ')[1], named.stdout.split('Storage: ')[1])
    for (const args of [['reset', '--yes=false'], ['reset', 'acme/shop', 'acme/shop', '--yes'], ['reset', 'missing/shop', '--yes']]) {
      const result = fixture.run(args)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Unknown option|only one instance|No instance/)
    }
    await fixture.assertPreserved()
  } finally { await fixture.close() }
})

test('reset refuses aliased upload storage', async () => {
  const fixture = await resetFixture()
  const original = `${fixture.stores[0]}-original`
  try {
    renameSync(fixture.stores[0], original)
    symlinkSync(fixture.stores[1], fixture.stores[0], 'junction')
    try {
      const result = fixture.run(['reset', '--yes'])
      assert.equal(result.status, 1)
      assert.match(result.stderr, /symbolic link/)
    } finally {
      unlinkSync(fixture.stores[0])
      renameSync(original, fixture.stores[0])
    }
    const nested = join(fixture.stores[0], 'linked')
    symlinkSync(fixture.stores[1], nested, 'junction')
    try {
      const result = fixture.run(['reset', '--yes'])
      assert.equal(result.status, 1)
      assert.match(result.stderr, /symbolic link/)
    } finally { unlinkSync(nested) }
    await fixture.assertPreserved()
  } finally { await fixture.close() }
})
