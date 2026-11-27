// stand-in-datasets' fenced scenarios that the server proves (#1409). Each
// test is one scenario of the spec, step by step; the two a person reads on
// screen (the page's line, the Datasets page) are in apps/web/test/scenarios/.
// The app is the Store Sales fixture; its warehouse is made-up rows.
import { describe, expect } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { STAND_IN_HEADER } from 'shared'
import { test as pgTest } from '../pg-test'
import { scenarioFor } from '../scenario'
import { expectRefused } from '../fixtures'
import { connectAgent, issueToken } from '../agent-driver'
import { sql } from '../../src/db'
import { withNamedVariable } from '../../src/env'
import { datasetBinding } from '../../src/dataset-bindings'
import { datasetsDue } from '../../src/jobs/refresh-datasets'
import { drainJobs, enqueue, loadJobs } from '../../src/jobs'
import { recordMiss } from '../../src/dataset-snapshot'
import { installedAppDatasets } from '../../src/runtime-packages'
import {
  READ, TARGETS, TARGETS_CSV, TARGET_ROWS, WAREHOUSE_TARGETS, WAREHOUSE_TARGET_ROWS,
  ask, loadTargets, pinned, storeSales, useWarehouse, warehouseTargets,
} from '../stand-in-fixture'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
const scenario = scenarioFor(test, 'stand-in-datasets')
useWarehouse()

type Switched = { switched: boolean; message: string; rows?: number }

describe('stand-in-datasets', () => {
  scenario('The app reads the file\'s rows', async ({ admin, createUser }, step) => {
    let reader!: TestClient
    let loaded!: { rows: number; loaded_at: string }
    await step('the Store Sales app needs a dataset "targets" that the warehouse does not have yet', async () => {
      // No Data Source at all, so the app is not set up; a stand-in needs none.
      ({ reader } = await storeSales(admin, createUser, { source: false }))
      await expectRefused(reader.post(`${READ}ask`, { payload: { dataset: 'targets' } }), 409, 'Store Sales is not set up yet')
    })
    await step('a System Manager loads a file of targets as its stand-in, with the note "From the planning workbook"', async () => {
      loaded = await loadTargets(admin, { note: 'From the planning workbook', expected_by: '2026-12-15' })
      expect(loaded.rows).toBe(3)
    })
    const answer = await ask(reader, 'targets')
    await step('the app\'s read of "targets" answers the file\'s rows', () => {
      expect(answer?.rows).toEqual(TARGET_ROWS)
    })
    await step('the answer says it is a stand-in, with the day it was loaded and its note', () => {
      expect(answer).toMatchObject({ dataset: 'targets', served: 'stand-in', at: loaded.loaded_at, standIn: { note: 'From the planning workbook', expectedBy: '2026-12-15' } })
    })
  })

  scenario('The refusal says what to fix', async ({ admin, createUser }, step) => {
    const { reader } = await storeSales(admin, createUser)
    await step('"targets" already has a stand-in', () => loadTargets(admin))
    const file = ['store,month,units,confirmed,comment', 'N1,2026-11-01,1200,true,ok', 'S1,2026-11-01,many,false,check'].join('\n')
    let refused!: Awaited<ReturnType<typeof expectRefused>>
    await step('a System Manager loads a file that lacks the "target" column, has an extra "comment" column and holds "many" as the units on row 3', async () => {
      refused = await expectRefused(admin.post(`${TARGETS}load_stand_in`, { csv: file }), 417)
    })
    await step('the file is refused', () => {
      expect(refused.message).toContain('The file does not fit targets.')
    })
    await step('the refusal names the missing column, the extra column, and the units value on row 3', () => {
      expect(refused.message).toContain('The file has no column "target", which targets needs')
      expect(refused.message).toContain('The file\'s column "comment" is not a column of targets')
      expect(refused.message).toContain('Row 3: "units" holds "many", which is not a whole number')
    })
    await step('the app\'s read of "targets" still answers the earlier rows', async () => {
      expect((await ask(reader, 'targets'))?.rows).toEqual(TARGET_ROWS)
    })
  })

  scenario('A view of a stand-in is recorded as one', async ({ admin, createUser }, step) => {
    const { reader } = await storeSales(admin, createUser)
    await step('"targets" is a stand-in', () => loadTargets(admin))
    await step('the user views the targets report', () => reader.post(`${READ}overview`, { payload: {} }))
    await step('the record of that view says a stand-in was served', async () => {
      expect(await sql`select ref_table, method from access_log where "user" = ${reader.user!} and operation = 'view_report'`)
        .toEqual([{ ref_table: 'storesales.targets', method: 'stand-in' }])
    })
  })

  scenario('A refresh runs while a stand-in serves', async ({ admin, createUser }, step) => {
    await loadJobs()
    const { reader } = await storeSales(admin, createUser)
    await step('"targets" is a stand-in and the warehouse now has targets of its own', async () => {
      await loadTargets(admin)
      await warehouseTargets(WAREHOUSE_TARGETS)
    })
    await step('the scheduled refresh runs', async () => {
      await enqueue('refresh_datasets')
      await sql`update background_job set run_at = now() where method = 'refresh_datasets' and job_status = 'queued'`
      await drainJobs()
      expect((await sql`select outcome from job_execution where method = 'refresh_datasets'`)[0].outcome).toBe('success')
    })
    await step('the app\'s read of "targets" still answers the stand-in\'s rows', async () => {
      expect(await ask(reader, 'targets')).toMatchObject({ served: 'stand-in', rows: TARGET_ROWS })
    })
  })

  scenario('The real figures replace the sample ones', async ({ admin, createUser }, step) => {
    const { reader } = await storeSales(admin, createUser)
    await step('"targets" is a stand-in whose figures total far more than the warehouse\'s', async () => {
      await loadTargets(admin)
      await warehouseTargets(WAREHOUSE_TARGETS)
    })
    await step('"targets" refuses a refresh whose total drops by more than a tenth', async () => {
      expect((await installedAppDatasets('storesales'))!.find((d) => d.name === 'targets')!.guard)
        .toEqual([{ kind: 'max_sum_drop_pct', column: 'target', value: 10 }])
    })
    await step('a System Manager switches "targets" to the warehouse', async () => {
      expect(await admin.post<Switched>(`${TARGETS}switch_to_warehouse`, {}))
        .toMatchObject({ switched: true, rows: 2, message: 'targets now reads the warehouse: 2 rows.' })
    })
    const answered = await reader.fetch(`${READ}ask`, { method: 'POST', body: JSON.stringify({ payload: { dataset: 'targets' } }) })
    const { result } = await answered.json() as { result: Record<string, unknown> }
    await step('the app\'s read of "targets" answers the warehouse\'s rows', () => {
      expect(result.rows).toEqual(WAREHOUSE_TARGET_ROWS)
    })
    await step('nothing marks them as a stand-in', async () => {
      expect(result.served).toBe('cached')
      expect(result).not.toHaveProperty('standIn')
      expect(answered.headers.get(STAND_IN_HEADER)).toBeNull()
      expect((await datasetBinding('storesales.targets'))?.served_from).toBe('Warehouse')
    })
  })

  scenario('The warehouse is not ready', async ({ admin, createUser }, step) => {
    const { reader } = await storeSales(admin, createUser)
    await step('"targets" is a stand-in and the warehouse has no targets', () => loadTargets(admin))
    let switched!: Switched
    await step('a System Manager switches "targets" to the warehouse', async () => {
      switched = await admin.post<Switched>(`${TARGETS}switch_to_warehouse`, {})
    })
    await step('the System Manager is told the refresh was refused and why', () => {
      expect(switched).toMatchObject({ switched: false, message: 'targets stays on its stand-in. The warehouse refresh was refused: candidate is empty: the query returned no rows.' })
    })
    await step('the app\'s read of "targets" still answers the stand-in\'s rows, marked as a stand-in', async () => {
      expect(await ask(reader, 'targets')).toMatchObject({ served: 'stand-in', rows: TARGET_ROWS })
      expect((await datasetBinding('storesales.targets'))?.served_from).toBe('Stand-in')
    })
  })

  scenario('Allowing a stand-in on production', async ({ admin, createUser }, step) => {
    const { reader } = await storeSales(admin, createUser)
    const onProduction = <T>(work: () => Promise<T>) => withNamedVariable('FEATHERBASE_ENV', 'production', work)
    await step('the instance is production')
    let refused!: Awaited<ReturnType<typeof expectRefused>>
    await step('a System Manager loads a stand-in for "targets"', async () => {
      refused = await onProduction(() => expectRefused(loadTargets(admin), 417))
    })
    await step('it is refused, saying a stand-in must be allowed for that dataset first', async () => {
      expect(refused.message).toContain('A stand-in on production must be allowed for its dataset first')
      expect(await onProduction(() => ask(reader, 'targets'))).toBeNull()
    })
    await step('a System Manager allows a stand-in for "targets" and loads the file again', async () => {
      await onProduction(async () => {
        await admin.post('/api/table/Dataset%20Binding', { row_id: 'storesales.targets', allowed_on_production: true })
        await loadTargets(admin)
      })
    })
    await step('the app\'s read of "targets" answers the file\'s rows, marked as a stand-in', async () => {
      expect(await onProduction(() => ask(reader, 'targets'))).toMatchObject({ served: 'stand-in', rows: TARGET_ROWS })
    })
  })

  scenario('Staging keeps a stand-in', async ({ admin, createUser }, step) => {
    await storeSales(admin, createUser)
    const file = {
      settings: {},
      environments: { staging: { settings: { 'Dataset Binding': [{ row_id: 'storesales.targets', served_from: 'Stand-in', note: 'Until the targets model lands' }] } } },
    }
    await step('the settings file binds "targets" to a stand-in on staging')
    await step('the file is applied on staging', () => admin.post('/api/instance-settings/apply', { file, environment: 'staging' }))
    await step('"targets" is bound to a stand-in there, and the scheduled refresh leaves it alone', async () => {
      expect(await datasetBinding('storesales.targets')).toMatchObject({ served_from: 'Stand-in', note: 'Until the targets model lands', allowed_on_production: false })
      // Even an ask recorded before the binding does not make it due.
      await recordMiss('storesales.targets')
      expect(await datasetsDue()).not.toContain('storesales.targets')
    })
  })

  scenario('An agent checks, then loads', async ({ admin, createUser }, step) => {
    await storeSales(admin, createUser)
    const agent = await connectAgent(await issueToken(admin))
    const file = { app: 'storesales', dataset: 'targets', csv: TARGETS_CSV }
    await step('an agent acting for a System Manager')
    const unchecked = await agent.call('load_stand_in', file)
    await step('the agent loads a file of targets without checking it first')
    await step('it is told to check the file first', () => {
      expect(unchecked.isError).toBe(true)
      expect(unchecked.content[0].text).toContain('Check the file first: run check_stand_in')
    })
    await step('the agent checks the file and loads it with the check it was given', async () => {
      const checked = await agent.ok<{ fits: boolean; rows: number; check: string }>('check_stand_in', file)
      expect(checked).toMatchObject({ fits: true, rows: 3, problems: [] })
      expect(await agent.ok('load_stand_in', { ...file, check: checked.check, note: 'From the planning workbook' })).toMatchObject({ rows: 3 })
    })
    await step('the agent\'s list of datasets shows "targets" as a stand-in', async () => {
      const { apps } = await agent.ok<{ apps: { app: string; datasets: Record<string, unknown>[] }[] }>('list_datasets', { app: 'storesales' })
      expect(apps).toHaveLength(1)
      expect(apps[0].datasets.find((d) => d.name === 'targets')).toMatchObject({ served_from: 'Stand-in', stand_in: true, rows: 3, note: 'From the planning workbook' })
    })
  })
})
