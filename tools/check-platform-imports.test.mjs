import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_FOLDERS, isPlatformSource, scan, specifiers } from './check-platform-imports.mjs'

const SCRIPT = fileURLToPath(new URL('./check-platform-imports.mjs', import.meta.url))
const FILE = 'apps/server/src/runtime/loader.ts'
const reasons = (text, packages) => scan(FILE, text, packages).map((h) => [h.line, h.specifier, h.reason])

test('the app folders are the example, client and test apps', () => {
  assert.deepEqual(APP_FOLDERS, ['example-apps', 'client-apps', 'test-apps'])
})

test('scope: platform source under apps/server, apps/web and packages; not tests, configs or apps', () => {
  for (const f of ['apps/server/src/a.ts', 'apps/web/src/b/c.tsx', 'packages/shared/src/d.mts', 'apps/server/src/e.mjs']) {
    assert.ok(isPlatformSource(f), f)
  }
  for (const f of ['apps/server/test/a.test.ts', 'apps/web/e2e/b.spec.ts', 'apps/web/vite.config.ts', 'example-apps/tasker/src/x.ts',
    'client-apps/c/a/src/y.ts', 'apps/web/src/index.css', 'packages/shared/package.json', 'tools/prepare-apps.mjs']) {
    assert.ok(!isPlatformSource(f), f)
  }
})

test('every loader form is read: import from, export from, bare import, import(), require, glob', () => {
  const text = [
    "import a from './a'",
    "import type { B } from \"./b\"",
    'import {',
    '  c,',
    "} from './c'",
    "export * from './d'",
    "import './e.css'",
    "const f = await import('./f')",
    "const g = require('./g')",
    "const h = require.resolve('./h')",
    "const i = import.meta.glob('./i/*.ts')",
  ].join('\n')
  assert.deepEqual(specifiers(text).map((s) => [s.line, s.specifier]), [
    [1, './a'], [2, './b'], [5, './c'], [6, './d'], [7, './e.css'], [8, './f'], [9, './g'], [10, './h'], [11, './i/*.ts'],
  ])
})

test('clean platform imports pass: own files, packages, node built-ins and a run-time path', () => {
  const text = [
    "import { Hono } from 'hono'",
    "import { readFile } from 'node:fs/promises'",
    "import { db } from '../db'",
    "import type { Table } from '@featherbase/shared'",
    'const app = await import(pathToFileURL(entry).href)',
    "const label = 'see example-apps/tasker for an app'",
  ].join('\n')
  assert.deepEqual(reasons(text, new Set(['@featherbase-learning/tasker'])), [])
})

test('a relative import that climbs into any app folder fails', () => {
  const text = [
    "import { TaskManagementPage } from '../../../../example-apps/tasker/src/TaskManagement'",
    "const dash = await import('../../../../client-apps/acme/board/server.mjs')",
    "const proof = require('../../../../test-apps/other/server.mjs')",
    "export { x } from '../../../../example-apps'",
  ].join('\n')
  assert.deepEqual(reasons(text), [
    [1, '../../../../example-apps/tasker/src/TaskManagement', 'resolves to example-apps/tasker/src/TaskManagement'],
    [2, '../../../../client-apps/acme/board/server.mjs', 'resolves to client-apps/acme/board/server.mjs'],
    [3, '../../../../test-apps/other/server.mjs', 'resolves to test-apps/other/server.mjs'],
    [4, '../../../../example-apps', 'resolves to example-apps'],
  ])
})

test('a relative import that stays inside the platform passes even with a look-alike name', () => {
  assert.deepEqual(reasons("import x from '../example-apps-catalog'\nimport y from './client-apps-list'"), [])
})

test('an alias naming an app folder, or an app package name, fails', () => {
  const text = [
    "import t from '@/example-apps/tasker/src/x'",
    "import o from '@featherbase-learning/other/server.mjs'",
    "import p from 'place-roster'",
  ].join('\n')
  assert.deepEqual(reasons(text, new Set(['@featherbase-learning/other', 'place-roster'])), [
    [1, '@/example-apps/tasker/src/x', 'names an app folder'],
    [2, '@featherbase-learning/other/server.mjs', 'is the app package @featherbase-learning/other'],
    [3, 'place-roster', 'is the app package place-roster'],
  ])
})

// End to end: the real script, run inside a throwaway git repository.
function run(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'platform-imports-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), text)
    }
    execFileSync('git', ['add', '-A'], { cwd: root })
    return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const APP = {
  'example-apps/tasker/package.json': '{"name":"@featherbase-learning/tasker"}',
  'example-apps/tasker/src/TaskManagement.tsx': 'export const TaskManagementPage = () => null\n',
  'apps/server/test/tasker.test.ts': "import { TaskManagementPage } from '../../../example-apps/tasker/src/TaskManagement'\n",
}

test('the script passes a repository whose platform imports no app, though a test does', () => {
  const result = run({ ...APP, 'apps/server/src/index.ts': "import { Hono } from 'hono'\n" })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /1 platform source files import no app code/)
})

test('the script fails on a planted violation and names the file, line and specifier', () => {
  const result = run({
    ...APP,
    'apps/web/src/shell.tsx': "import { Hono } from 'hono'\nimport { TaskManagementPage } from '../../../example-apps/tasker/src/TaskManagement'\n",
    'packages/shared/src/index.ts': "export const tasker = () => import('@featherbase-learning/tasker')\n",
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /2 import\(s\) of app code/)
  assert.match(result.stderr, /apps\/web\/src\/shell\.tsx:2 {2}'\.\.\/\.\.\/\.\.\/example-apps\/tasker\/src\/TaskManagement' resolves to example-apps\/tasker\/src\/TaskManagement/)
  assert.match(result.stderr, /packages\/shared\/src\/index\.ts:1 {2}'@featherbase-learning\/tasker' is the app package @featherbase-learning\/tasker/)
})
