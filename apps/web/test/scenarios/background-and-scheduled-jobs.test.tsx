// background-and-scheduled-jobs' fenced scenario a person works on screen
// (#1070): a System Manager schedules a copied Plants table from its list,
// pauses it and changes it, rendered in jsdom against the real in-process
// server and the local MotherDuck stand-in. The refresh runs themselves are
// in apps/server/test/scenarios/.
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import type { TestClient } from 'feather-testing-postgres'
import { overrideVariable } from 'server/src/env'
import { invalidateSources } from 'server/src/sources/registry'
import { buildStandin, changeStandin, STANDIN_TOKENS } from 'server/test/motherduck-standin'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderSession, type Session } from '../pg-test'

const scenario = scenarioFor(test, 'background-and-scheduled-jobs')
const WAIT = { timeout: 15_000 }

let dir: string
beforeAll(async () => {
  dir = await buildStandin()
  overrideVariable('MOTHERDUCK_STANDIN', dir)
  overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
})
afterAll(() => {
  invalidateSources()
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  rmSync(dir, { recursive: true, force: true })
})

type Schedule = { row_id: string; cadence: string; enabled: boolean }

async function copiedPlants(admin: TestClient) {
  const source = `refresh-${randomUUID().slice(0, 8)}`
  const relation = `plants_${randomUUID().replaceAll('-', '')}`
  await changeStandin(dir, 'sales', [
    `create table ${relation} (code varchar, name varchar)`,
    `insert into ${relation} values ('P01', 'Rose'), ('P02', 'Fern')`,
  ])
  await admin.post('/api/table/Data%20Source:motherduck_connect', { name: source, databases: ['sales'] })
  await admin.post(`/api/table/Data%20Source/${encodeURIComponent(source)}:copy_create`, {
    database: 'sales', schema: 'main', table: relation, name: 'Plants', key: 'code',
    columns: [{ source: 'code', column_name: 'code' }, { source: 'name', column_name: 'title' }],
  })
}

// The control's <label> also holds its options' text, so the DSL's label lookup can't
// name it; and the DSL has no verb for a control being enabled.
const refreshControl = () => screen.getByRole('combobox', { name: 'Refresh automatically' }) as HTMLSelectElement

async function openPlants(admin: TestClient): Promise<{ session: Session }> {
  cleanup()
  const { session } = await renderSession('/featherbase/admin/table/plants', admin, { session: WAIT })
  await waitFor(() => expect(refreshControl()).toBeEnabled(), WAIT)
  return { session }
}

function schedule(session: Session, cadence: string): Session {
  return session
    .step(`refresh automatically: ${cadence}`, ({ user }) => user.selectOptions(refreshControl(), cadence))
    .until('the refresh control is enabled again', () => !refreshControl().disabled)
    .assertText('Pause')
}

describe('background-and-scheduled-jobs', () => {
  scenario('Plants refresh hourly', async ({ admin }, step) => {
    let session!: Session
    const scheduleInfo = () => admin.get<Schedule | null>('/api/table/Plants:copy_schedule')
    await step('the user is a System Manager with a copied Plants table', async () => {
      await copiedPlants(admin)
      ;({ session } = await openPlants(admin))
    })
    await step('the user schedules Plants to refresh hourly', () => schedule(session, 'hourly'))
    await step('Plants has one hourly schedule that the user can pause and change', async () => {
      const original = (await scheduleInfo())!
      expect(original.cadence).toBe('hourly')
      expect(original.enabled).toBe(true)
      ;({ session } = await openPlants(admin))
      expect(refreshControl().value).toBe('hourly')
      await session.clickButton('Pause').assertText('Resume')
      ;({ session } = await openPlants(admin))
      expect(refreshControl().value).toBe('off')
      await schedule(session, 'daily')
      const changed = (await scheduleInfo())!
      expect(changed.row_id).toBe(original.row_id)
      expect(changed.cadence).toBe('daily')
      expect(changed.enabled).toBe(true)
    })
  }, 60_000)
})
