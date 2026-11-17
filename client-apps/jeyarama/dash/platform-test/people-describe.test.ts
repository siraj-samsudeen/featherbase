// #1267: the platform asks Dash who people are, by real reads on the platform: an Employee row
// that is Current makes an Employee, only Left rows a Former Employee, none an External person.
// Dash answers only the platform's describe actor, never a person calling the read. Made-up people.
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { APP_DIR, createCoreTables, installApp, pinned, saveRow } from './helpers'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
process.env.MOTHERDUCK_TOKEN = 'made-up-token'
void APP_DIR

type Standing = { status: string; code: string | null; jobs: { job: string; site?: { table: string; id: string; name: string } }[]; external_label: string | null }

test("a person's standing comes from Dash's Employee rows, with each job's store", async ({ admin, createUser }) => {
  await installApp(admin)
  await createCoreTables(admin)
  const site = await saveRow(admin, 'Site', { code: 'LKS', name: 'Lakeside', is_store: true }) as { row_id: string }
  const asha = await createUser({ email: 'pd-asha@example.test' })
  const old = await createUser({ email: 'pd-old@example.test' })
  const guest = await createUser({ email: 'pd-guest@example.test' })
  await saveRow(admin, 'Employee', { employee_code: 'A1', name: 'Asha Example', person: asha.user, status: 'Current' })
  await saveRow(admin, 'Employee', { employee_code: 'L1', name: 'Old Example', person: old.user, status: 'Left' })
  await saveRow(admin, 'Job Assignment', { assignment_id: 'JA-A1', employee: 'A1', job: 'Team Leader', site: 'LKS', starts_on: '2026-01-01' })

  expect(await admin.get<Standing>(`/api/people/${asha.user}/standing`)).toEqual({
    status: 'current', code: 'A1', external_label: null,
    jobs: [{ job: 'Team Leader', site: { table: 'Site', id: site.row_id, name: 'Lakeside' } }],
  })
  expect(await admin.get<Standing>(`/api/people/${old.user}/standing`)).toEqual({ status: 'left', code: 'L1', jobs: [], external_label: null })
  expect((await admin.get<Standing>(`/api/people/${guest.user}/standing`)).status).toBe('none')
})

test('a person calling the describe read is refused, even a System Manager', async ({ admin, createUser }) => {
  await installApp(admin)
  await createCoreTables(admin)
  const boss = await createUser({ email: 'pd-boss@example.test', roles: ['Dash Reader', 'System Manager'] })
  const answer = await boss.fetch('/api/app_reads/dash/describe_people', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: { persons: [boss.user] } }),
  })
  expect(answer.status).toBeGreaterThanOrEqual(400)
  expect(await answer.text()).toContain('Only the platform describes people')
})
