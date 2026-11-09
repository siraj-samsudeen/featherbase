import { expect } from 'vitest'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { expectRefused } from './fixtures'

test('runtime validators inspect owned rows through caller permissions and abort invalid saves', async ({ admin }) => {
  const directory = await mkdtemp(resolve('test/.validation-'))
  try {
    await cp(resolve('../..', 'test-apps/other'), directory, { recursive: true })
    await writeFile(resolve(directory, 'server.mjs'), `
      export const platformVersion = '2026-10'
      export const validators = {
        'other.task': async ctx => {
          const rows = await ctx.documents.list('other.task', { fields: ['quantity'] })
          if (rows.some(row => row.quantity === ctx.row.quantity)) ctx.reject('Quantity already represented')
          ctx.row.validation_runs = rows.length + 1
        }
      }
    `)
    expect(await discoverPackages([directory])).toEqual([])
    await admin.post('/api/install_app', { name: 'other' })
    const first = await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'first', quantity: 37 } })
    expect(first).toMatchObject({ validation_runs: 1 })
    await expectRefused(admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'duplicate', quantity: 37 } }), 417, 'already represented')
    expect(await admin.post('/api/save_row', { table: 'other.task', row: { row_id: 'second', quantity: 19 } })).toMatchObject({ validation_runs: 2 })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
