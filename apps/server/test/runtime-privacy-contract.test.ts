import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, test as unitTest } from 'vitest'
import { migrationSchema, replayForward, validateMigrations } from '../src/runtime-migrations'
import { discoverPackages } from '../src/runtime-packages'
import { test } from './pg-test'

const policy = { version: 1 as const, roles: ['Members'], shared_column: 'shared' }
const table = { name: 'proof.note', label: 'Note', columns: [{ column_name: 'shared', column_type: 'Check' as const }] }

describe('mandatory privacy migration declarations', () => {
  unitTest.each([
    { label: 'connected collection', row: { ...table, data_source: 'external' } },
    { label: 'embedded rows', row: { ...table, kind: 'sub_table' as const } },
  ])('rejects mandatory privacy on $label', ({ row }) => {
    expect(() => replayForward('proof', [row], [{ kind: 'addAccessPolicy', table: table.name, policy }])).toThrow('Mandatory access requires a local collection')
  })
  unitTest.each([
    { policy: { version: 1 as const, roles: ['Members'], shared_column: 'absent' }, message: 'absent must be Check' },
    { policy: { version: 1 as const, roles: ['Members'], inherit_column: 'shared' }, message: 'shared must be Reference' },
  ])('rejects an invalid access column: $message', ({ policy, message }) => {
    expect(() => replayForward('proof', [table], [{ kind: 'addAccessPolicy', table: table.name, policy }])).toThrow(message)
  })
  unitTest('refuses history that rewrites the final mandatory policy', () => {
    const migration = migrationSchema.parse({ id: 'privacy', fromVersion: '1.0.0', toVersion: '2.0.0', operations: [{ kind: 'addAccessPolicy', table: table.name, policy }] })
    expect(() => validateMigrations('proof', '2.0.0', [{ ...table, access_policy: { ...policy, roles: ['Different members'] } }], [migration])).toThrow('Mandatory access does not match the declared policy')
  })
})

test.for([
  { name: 'declared membership', role: 'Members', declared: true, write: false, allowed: true },
  { name: 'undeclared membership', role: 'Members', declared: false, write: false, allowed: false },
  { name: 'Guest audience', role: 'Guest', declared: true, write: false, allowed: false },
  { name: 'expanded member writes', role: 'Members', declared: true, write: true, allowed: false },
  { name: 'expanded All writes', role: 'All', declared: true, write: true, allowed: false },
])('upgrade audience contract: $name', async ({ role, declared, write, allowed }, { admin }) => {
  const source = resolve('../..', 'test-apps/other')
  const target = await mkdtemp(resolve('test/.privacy-grants-'))
  try {
    await cp(source, target, { recursive: true })
    const manifest = JSON.parse(await readFile(resolve(target, 'featherbase.json'), 'utf8'))
    const pkg = JSON.parse(await readFile(resolve(target, 'package.json'), 'utf8'))
    manifest.roles = declared ? [role] : []
    manifest.permissions = [{ table: 'other.task', role, can_read: true, ...(write ? { can_write: true } : {}) }]
    manifest.migrations = [{ id: 'member_audience', fromVersion: pkg.version, toVersion: '2.0.0', operations: [] }]
    await writeFile(resolve(target, 'featherbase.json'), JSON.stringify(manifest))
    await writeFile(resolve(target, 'package.json'), JSON.stringify({ ...pkg, version: '2.0.0' }))
    expect(await discoverPackages([source])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    expect(await discoverPackages([source, target])).toEqual([])
    const preview = admin.post<{ permissions: unknown[] }>('/api/preview_app_upgrade', { name: 'other', version: '2.0.0' })
    if (allowed) expect(await preview).toMatchObject({ permissions: expect.arrayContaining([{ grant: { table: 'other.task', role: 'Members', can_read: true } }]) })
    else await expect(preview).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Permission or package identity changes are unsupported') })
  } finally { await rm(target, { recursive: true, force: true }) }
})
