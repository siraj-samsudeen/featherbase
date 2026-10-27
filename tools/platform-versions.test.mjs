import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { platformVersions } from './platform-versions.mjs'

test('the versions are read from the SUPPORTED_PLATFORM_VERSIONS declaration', () => {
  const source = "// note\nexport const SUPPORTED_PLATFORM_VERSIONS: readonly string[] = ['2026-10']\nconst x = 1"
  assert.deepEqual(platformVersions(source), ['2026-10'])
})

test('every listed version is read, whichever quote it uses', () => {
  const source = `export const SUPPORTED_PLATFORM_VERSIONS: readonly string[] = ['2026-10', "2026-11"]`
  assert.deepEqual(platformVersions(source), ['2026-10', '2026-11'])
})

test('a source without the declaration is refused', () => {
  assert.throws(() => platformVersions('export const OTHER = []'), /SUPPORTED_PLATFORM_VERSIONS/)
})

test('an entry that is not a month is refused', () => {
  assert.throws(() => platformVersions("export const SUPPORTED_PLATFORM_VERSIONS = ['2026-10', VERSION]"), /not a month/)
})

test('the server source declares at least one month', () => {
  const source = readFileSync(new URL('../apps/server/src/runtime-packages.ts', import.meta.url), 'utf8')
  const versions = platformVersions(source)
  assert.ok(versions.length > 0)
  for (const version of versions) assert.match(version, /^\d{4}-(0[1-9]|1[0-2])$/)
})
