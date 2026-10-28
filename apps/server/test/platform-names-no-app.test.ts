// ADR 0011, one-way knowledge: the platform never names an app. Which app an
// address opens, and the name its bar shows, come from the instance's
// INSTANCE_ADDRESSES `opens` and the installed app itself. Until B9 (#550,
// task 2.19) the interim Feather Dash coupling keeps the literal in platform
// code, so this pin is `test.fails`; B9 removes the literals, the pin starts
// failing, and it flips to a plain test in the same change.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const PLATFORM_SOURCES = ['apps/server/src', 'apps/web/src', 'packages/shared/src']
const APP_NAMES = /feather_dash|INTERIM_APPS/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|mts|js|mjs)$/.test(entry) ? [path] : []
  })
}

function filesNamingAnApp(): string[] {
  return PLATFORM_SOURCES.flatMap(dir => sourceFiles(join(ROOT, dir)))
    .filter(path => APP_NAMES.test(readFileSync(path, 'utf8')))
    .map(path => relative(ROOT, path))
}

describe('platform code names no app (ADR 0011)', () => {
  test('the scan reads every platform source folder', () => {
    // Guards the scan itself, so an empty walk can never pass the pin below.
    for (const dir of PLATFORM_SOURCES) expect(sourceFiles(join(ROOT, dir)).length).toBeGreaterThan(10)
  })

  test.fails('#550 B9: no platform source names an app or the interim app table', () => {
    expect(filesNamingAnApp()).toEqual([])
  })
})
