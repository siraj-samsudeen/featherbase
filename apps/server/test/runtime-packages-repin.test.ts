// #703: a development database follows an app's files when only they changed.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { installApp, uninstallApp } from '../src/apps'
import { discoverPackages, repinToFolder } from '../src/runtime-packages'
import { sql } from '../src/db'
import '../src/index'

// Under test/ (gitignored scratch), since the loader's import resolves there.
const folder = mkdtempSync(join(import.meta.dirname, '.repin-'))
const manifestFile = join(folder, 'featherbase.json')
const packageFile = join(folder, 'package.json')
let name: string

beforeAll(async () => {
  cpSync(resolve(import.meta.dirname, '../../../test-apps/other'), folder, { recursive: true })
  name = JSON.parse(readFileSync(manifestFile, 'utf8')).name
  await discoverPackages([folder])
  await installApp(name)
})

afterAll(async () => {
  await uninstallApp(name)
  await discoverPackages([])
  rmSync(folder, { recursive: true, force: true })
})

test('what happens when an installed app\'s folder changes', async () => {
  expect(await repinToFolder('not_a_runtime_app', true)).toBe('same')
  expect(await repinToFolder(name, true)).toBe('same')

  writeFileSync(join(folder, 'NOTES.md'), 'a file changed\n')
  await discoverPackages([folder])
  expect(await repinToFolder(name, false)).toBe('different')
  expect(await repinToFolder(name, true)).toBe('repinned')
  expect(await repinToFolder(name, true)).toBe('same')

  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  writeFileSync(manifestFile, JSON.stringify({ ...manifest, title: `${manifest.title} changed` }))
  await discoverPackages([folder])
  expect(await repinToFolder(name, true)).toBe('different')

  const pkg = JSON.parse(readFileSync(packageFile, 'utf8'))
  writeFileSync(packageFile, JSON.stringify({ ...pkg, version: '99.0.0' }))
  await discoverPackages([folder])
  expect(await repinToFolder(name, true)).toBe('different')
  const [row] = await sql`select package_version from installed_app where name = ${name}`
  expect(row.package_version).toBe(pkg.version)
})
