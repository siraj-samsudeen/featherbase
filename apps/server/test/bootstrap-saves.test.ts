import { expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { deleteDoc, saveDoc } from '../src/document'
import { logActivity } from '../src/audit'
import { runApiScript } from '../src/server-scripts'
import { getActiveSla } from '../src/sla'
import { getActiveWorkflow } from '../src/workflow'
import { drainJobs, enqueue, loadJobs } from '../src/jobs'
import { getCatalog } from '../src/i18n'
import { lastApply } from '../src/managed-settings'

// Early bootstrap migrations save rows before every platform Table exists
// (platform-tables.ts). This file asks first, before anything in this process
// has seen those Tables, so their absence is what the save meets. The renames
// roll back with the test's transaction.
const LATER_TABLES = ['email_rule', 'assignment_rule', 'webhook', 'server_script', 'activity_log', 'service_level_agreement', 'workflow_document_state', 'translation', 'instance_settings_apply']

test('a row saved before the platform rule Tables exist is saved without them', async () => {
  for (const table of LATER_TABLES) await sql.unsafe(`alter table featherbase.${table} rename to ${table}_not_yet`)
  const saved = await saveDoc('ToDo', { description: 'saved during bootstrap', allocated_to: 'Administrator' }, 'Administrator', 'insert')
  expect(await sql`select description from featherbase.todo where row_id = ${String(saved.row_id)}`).toEqual([{ description: 'saved during bootstrap' }])
  await logActivity('Administrator', 'bootstrap activity')
  expect(await getActiveSla('ToDo')).toBeNull()
  expect(await getCatalog('fr')).toEqual({})
  expect(await lastApply()).toBeNull()
  expect(await getActiveWorkflow('ToDo')).toBeNull()
  await expect(runApiScript('bootstrap_method', {})).rejects.toMatchObject({ type: 'NotFoundError', message: 'No such server script: bootstrap_method' })
  await loadJobs()
  await enqueue('check_sla', {})
  await sql`update background_job set run_at = now() - interval '1 second' where method = 'check_sla'`
  expect(await drainJobs()).toBe(1)
  expect(await sql`select job_status from background_job where method = 'check_sla'`).toEqual([{ job_status: 'done' }])
})

test('a person is saved, renamed and removed before identifiers are recorded', async () => {
  await sql.unsafe('alter table featherbase.person_identifier rename to person_identifier_not_yet')
  const renamed = String((await saveDoc('Person', { email: 'early.person@example.com' }, 'Administrator', 'insert')).row_id)
  const [row] = await sql`select updated_at from person where row_id = ${renamed}`
  await saveDoc('Person', { row_id: renamed, updated_at: row.updated_at, email: 'early.renamed@example.com' }, 'Administrator')
  expect(await sql`select email from person where row_id = ${renamed}`).toEqual([{ email: 'early.renamed@example.com' }])
  const removed = String((await saveDoc('Person', { email: 'early.removed@example.com' }, 'Administrator', 'insert')).row_id)
  await deleteDoc('Person', removed)
  expect(await sql`select 1 from person where row_id = ${removed}`).toHaveLength(0)
})
