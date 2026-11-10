import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { copyShipped, workspaceDependencies } from './build-instance-apps.mjs'

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

test('an app built from an archive names the workspace packages it takes by path', (t) => {
  const dir = scratch(t)
  const app = join(dir, 'example-apps/board')
  mkdirSync(app, { recursive: true })
  mkdirSync(join(dir, 'packages/kit'), { recursive: true })
  writeFileSync(join(dir, 'packages/kit/package.json'), JSON.stringify({ name: '@x/kit' }))
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0', '@x/kit': 'file:../../packages/kit' } }))
  assert.deepEqual(workspaceDependencies(app, dir), ['@x/kit'])
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }))
  assert.deepEqual(workspaceDependencies(app, dir), [])
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { kit: 'file:../../../elsewhere' } }))
  assert.throws(() => workspaceDependencies(app, dir), /outside the archive/)
})
