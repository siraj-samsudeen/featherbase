import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { copyShipped, previousVersions } from './build-instance-apps.mjs'

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'instance-apps-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('an image holds only what an app ships, in a folder per version', (t) => {
  const dir = scratch(t)
  const app = join(dir, 'app')
  mkdirSync(join(app, 'dist'), { recursive: true })
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: '@x/board', version: '1.2.3' }))
  writeFileSync(join(app, 'featherbase.json'), JSON.stringify({ name: 'board' }))
  writeFileSync(join(app, 'dist/server.mjs'), '')
  writeFileSync(join(app, 'README.md'), 'not shipped')
  mkdirSync(join(app, 'src'))
  const { name, version, target } = copyShipped(app, join(dir, 'out'))
  assert.deepEqual([name, version], ['board', '1.2.3'])
  assert.equal(target, join(dir, 'out/instance-apps/board-1.2.3'))
  assert.ok(existsSync(join(target, 'dist/server.mjs')))
  assert.ok(!existsSync(join(target, 'README.md')))
  assert.ok(!existsSync(join(target, 'src')))
})

test('previousVersions is optional, and each entry must say where the version comes from', (t) => {
  const file = join(scratch(t), 'instance.json')
  writeFileSync(file, JSON.stringify({ apps: ['a'] }))
  assert.deepEqual(previousVersions(file), [])
  const good = { path: 'client-apps/x/a', version: '1.0.0', archive: 'https://example.com/x.tar.gz' }
  writeFileSync(file, JSON.stringify({ apps: ['a'], previousVersions: [good] }))
  assert.deepEqual(previousVersions(file), [good])
  writeFileSync(file, JSON.stringify({ apps: ['a'], previousVersions: [{ ...good, archive: 'http://example.com/x.tar.gz' }] }))
  assert.throws(() => previousVersions(file), /https archive/)
})
