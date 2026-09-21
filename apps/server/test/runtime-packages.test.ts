import { describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'

describe('PKG-R1/PKG-R3: trusted package lifecycle', () => {
  test('disable rejects stale writes, preserves rows, and enable wires validation once', async ({ admin }) => {
    await discoverPackages([resolve('../..', 'runtime-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    const row = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'other.task', row: { row_id: 'same', quantity: 37 },
    })
    expect(row.validation_runs).toBe('1')
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    await expect(admin.post('/api/save_row', {
      table: 'other.task', row: { ...row, quantity: -9 },
    })).rejects.toMatchObject({ status: 403 })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: true })
    expect(await admin.get('/api/table/other.task/same')).toMatchObject({ quantity: '37' })
    await expect(admin.post('/api/save_row', {
      table: 'other.task', row: { ...row, quantity: -9 },
    })).rejects.toMatchObject({ status: 417, fields: { quantity: 'Must be positive' } })
    expect(await admin.post('/api/save_row', {
      table: 'other.task', row: { ...row, quantity: 11 },
    })).toMatchObject({ validation_runs: '2' })
  })

  test('PKG-R4: ordinary member catalog and client root are separate from management and server files', async ({ admin, createUser }) => {
    expect(await discoverPackages([resolve('../..', 'runtime-apps/other')])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    const member = await createUser({ email: 'runtime-reader@example.com', roles: ['All'] })
    expect(await member.get('/api/app_catalog')).toEqual([
      { name: 'other', title: 'Other tasks', href: '/apps/other/' },
    ])
    await expect(member.get('/api/apps')).rejects.toMatchObject({ status: 403 })
    await expect(member.post('/api/save_row', { table: 'other.task', row: { row_id: 'no', quantity: 3 } }))
      .rejects.toMatchObject({ status: 403 })
    const page = await member.fetch('/apps/other/')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<h1>Other tasks</h1>')
    for (const path of ['server.mjs', 'package.json', 'missing.js', '%2e%2e%2fserver.mjs'])
      expect((await member.fetch(`/apps/other/${path}`)).status).toBe(404)
    await admin.post('/api/set_app_enabled', { name: 'other', enabled: false })
    expect(await member.get('/api/app_catalog')).toEqual([])
    expect((await member.fetch('/apps/other/')).status).toBe(404)
  })

  test('PKG-J2: restart without compatible code fails closed, restoring code preserves data', async ({ admin }) => {
    const source = resolve('../..', 'runtime-apps/other')
    await discoverPackages([source])
    await admin.post('/api/install_app', { name: 'other' })
    await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'survivor', quantity: 19 } })
    await discoverPackages([])
    await loadInstalledApps()
    await expect(admin.get('/api/table/other.task/survivor')).rejects.toMatchObject({ status: 403 })
    const status = await admin.get<{ installed: unknown[] }>('/api/apps')
    expect(status.installed).toContainEqual(expect.objectContaining({ name: 'other', enabled: true, available: false, active: false }))
    const directory = await mkdtemp(resolve(tmpdir(), 'featherbase-package-'))
    try {
      await cp(source, directory, { recursive: true })
      const file = resolve(directory, 'featherbase.json')
      const manifest = JSON.parse(await readFile(file, 'utf8'))
      await writeFile(file, JSON.stringify({ ...manifest, apiVersion: 99 }))
      expect(await discoverPackages([directory])).toHaveLength(1)
      await loadInstalledApps()
      await expect(admin.post('/api/set_app_enabled', { name: 'other', enabled: true }))
        .rejects.toMatchObject({ status: 417 })
      await expect(admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'new', quantity: 12 } }))
        .rejects.toMatchObject({ status: 403 })
    } finally { await rm(directory, { recursive: true, force: true }) }
    await discoverPackages([source])
    await loadInstalledApps()
    await loadInstalledApps()
    const row = await admin.get<Record<string, unknown>>('/api/table/other.task/survivor')
    expect(row).toMatchObject({ quantity: '19', validation_runs: '1' })
    expect(await admin.post('/api/save_row', { table: 'other.task', row: { ...row, quantity: 23 } }))
      .toMatchObject({ validation_runs: '2' })
  })
})
