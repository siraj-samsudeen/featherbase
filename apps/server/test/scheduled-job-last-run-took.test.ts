// #1348 (folded in by the UI owner): the Scheduled Job list's "Last Duration MS" reads "Last Run Took".
import { expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

const MIGRATION = new URL('../migrations/0176_last_run_took.sql', import.meta.url)
const label = async () => (await sql<{ label: string }[]>`
  select label from column_def where parent = 'Scheduled Job' and column_name = 'last_duration_ms'`)[0]?.label

test("a Scheduled Job's last run time is labelled Last Run Took", async ({ admin }) => {
  invalidateMeta()
  const meta = await admin.get<{ columns: { column_name: string; label: string }[] }>('/api/table/Scheduled%20Job:meta')
  expect(meta.columns.find((c) => c.column_name === 'last_duration_ms')?.label).toBe('Last Run Took')
})

test('the rename keeps a label an administrator wrote', async () => {
  await sql`update column_def set label = 'Run time' where parent = 'Scheduled Job' and column_name = 'last_duration_ms'`
  await sql.unsafe(readFileSync(MIGRATION, 'utf8'))
  expect(await label()).toBe('Run time')
})
