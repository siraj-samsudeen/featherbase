import { resolve } from 'node:path'
import { expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { getDoc, saveDoc } from '../src/document'
import { taskerClient } from './tasker-client'
import { version } from '../../../example-apps/tasker/package.json'
import { expectStatus } from './fixtures'

test('the revival upgrade keeps former personal work editable as shared tasks', async ({ admin, createUser }) => {
  const old = resolve('../..', 'test-apps/fixtures/tasker-v2.3')
  const current = resolve('../..', 'example-apps/tasker')
  expect(await discoverPackages([old])).toEqual([])
  await admin.post('/api/install_app', { name: 'tasker' })
  const formerOwner = await createUser({ roles: [] })
  const response = await admin.fetch('/api/save_row', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'tasker@2.3.0' }, body: JSON.stringify({ table: 'tasker.task', row: { task_title: 'Existing personal work', personal_tasks_owner: formerOwner.user } }) })
  await expectStatus(response, 201)
  const legacy = await response.json() as { row_id: string }
  expect(await discoverPackages([old, current])).toEqual([])
  await loadInstalledApps()
  const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'tasker', version })
  await admin.post('/api/upgrade_app', { name: 'tasker', version, planId: plan.planId })
  expect(await discoverPackages([old, current])).toEqual([])
  await loadInstalledApps()
  await admin.post('/api/activate_app_upgrade', { name: 'tasker', version })
  const person = await getDoc('Person', 'Administrator', 'Administrator')
  await saveDoc('Person', { ...person, roles: [...person.roles as Record<string, unknown>[], { role: 'Tasker Member' }] }, 'Administrator')
  const client = taskerClient(admin)
  const migrated = await client.get<{ updated_at: string }>(`/api/table/tasker.task/${legacy.row_id}`)
  expect(migrated).toMatchObject({ task_title: 'Existing personal work', personal_tasks_owner: formerOwner.user, assigned_to: formerOwner.user, shared: true })
  expect(migrated).toHaveProperty('acknowledged_at', expect.anything())
  expect(await client.post('/api/save_row', { table: 'tasker.task', row: { row_id: legacy.row_id, updated_at: migrated.updated_at, assigned_to: 'Administrator' } })).toMatchObject({ assigned_to: 'Administrator', shared: true })
})
