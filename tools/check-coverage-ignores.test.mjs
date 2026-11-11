import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collect, scan } from './check-coverage-ignores.mjs'

// Built at runtime so this file does not itself read as an ignore.
const IGNORE = (tool) => [tool, 'ignore'].join(' ')

test('an ignore with a reason after -- is read with that reason', () => {
  assert.deepEqual(scan(`a\n/* ${IGNORE('v8')} next -- only a signal ends the child */\nb`),
    [{ line: 2, tool: 'v8', reason: 'only a signal ends the child' }])
})

test('an ignore with no reason, or nothing after --, has none', () => {
  assert.deepEqual(scan(`/* ${IGNORE('istanbul')} next */`).map((i) => i.reason), [''])
  assert.deepEqual(scan(`/* ${IGNORE('c8')} next 2 -- */`).map((i) => i.reason), [''])
})

test('each of v8, c8 and istanbul is found, in a line comment too', () => {
  const text = `// ${IGNORE('c8')} next -- x\n/* ${IGNORE('istanbul')} else -- y */\n/* ${IGNORE('v8')} start -- z */`
  assert.deepEqual(scan(text).map((i) => i.tool), ['c8', 'istanbul', 'v8'])
})

test('a mention without ignore is not an ignore', () => {
  assert.deepEqual(scan('// the v8 provider counts branches'), [])
})

test('collect reads the server, web and package sources only', () => {
  const root = mkdtempSync(join(tmpdir(), 'coverage-ignores-'))
  try {
    for (const dir of ['apps/server/src', 'apps/web/src', 'packages/kit/src', 'apps/server/test'])
      mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, 'apps/server/src/a.ts'), `/* ${IGNORE('v8')} next -- reason */\n`)
    writeFileSync(join(root, 'apps/web/src/b.tsx'), `/* ${IGNORE('istanbul')} next */\n`)
    writeFileSync(join(root, 'packages/kit/src/c.ts'), `/* ${IGNORE('c8')} next -- why */\n`)
    writeFileSync(join(root, 'apps/server/test/d.ts'), `/* ${IGNORE('v8')} next */\n`)
    assert.deepEqual(collect(root).map((i) => [i.file, i.reason]).sort(), [
      ['apps/server/src/a.ts', 'reason'], ['apps/web/src/b.tsx', ''], ['packages/kit/src/c.ts', 'why'],
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
