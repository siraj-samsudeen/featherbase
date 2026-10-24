// #432: audit tables are system-written. No principal — not Administrator, not
// a System Manager, not an access token — may create, change or delete their
// rows through the generic API, bulk paths or structure changes; only the
// server's own writers (sign-in logging, the job runner, the import logger,
// the version trail) put rows there. Reads are unchanged.
import { describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { app } from '../src/index'
import * as documentModule from '../src/document'
import { getCollectionAction, listActions } from '../src/actions'
import { logActivity } from '../src/audit'
import { setUserPassword } from '../src/auth'
import { drainJobs, enqueue, loadJobs } from '../src/jobs'
import { queueEmail } from '../src/email'
import { expectApiError, grantRole, makeTable, patchDoc } from './fixtures'
import postgres from 'postgres'
import { config } from '../src/config'
import { getMeta } from '../src/meta'
import { applyWorkflowAction, ensureStateField } from '../src/workflow'
import { invalidateSources } from '../src/sources/registry'
import { EXTERNAL_DATABASE_URL } from './external-database'

const AL = 'Activity Log'
const ENC = encodeURIComponent(AL)
const REFUSED = { status: 403, type: 'PermissionError', message: expect.stringMatching(/written only by the platform/) }

// The decision per platform table, as the migration sets it. Every table here
// is written by the server alone; the ones left out are edited by people.
const SYSTEM_WRITTEN = [
  'Access Log',
  'Activity Log',
  'Background Job',
  'Dataset Miss',
  'Dataset Snapshot',
  'Email Queue',
  'Email Sink',
  'Import Log',
  'Job Execution',
  'Notification Log',
  'User Event',
  'Version',
]

async function seedActivity(operation = 'seeded for #432'): Promise<string> {
  await logActivity('Administrator', operation)
  const [row] = await sql`select row_id from activity_log where operation = ${operation} order by created_at desc limit 1`
  return String(row.row_id)
}

// A Bearer-token client: a service account holding System Manager, so the
// token is as privileged as a token can be.
async function tokenClient(admin: TestClient, api: TestClient): Promise<TestClient> {
  const sa = await admin.post<{ row_id: string }>('/api/service_accounts', {
    label: 'audit-forger-bot',
    roles: ['System Manager'],
  })
  const { token } = await admin.post<{ token: string }>('/api/access_tokens', { label: 'forger', owner: sa.row_id })
  const auth = { authorization: `Bearer ${token}` }
  const wrap = (init: RequestInit = {}) => ({ ...init, headers: { ...auth, ...(init.headers ?? {}) } })
  const asJson = async (res: Response) => {
    if (!res.ok) return res
    return res.json()
  }
  return {
    ...api,
    fetch: (path: string, init?: RequestInit) => api.fetch(path, wrap(init)),
    get: (path: string) => api.fetch(path, wrap()).then(asJson),
    post: (path: string, body?: unknown) =>
      api.fetch(path, wrap({ method: 'POST', body: JSON.stringify(body ?? {}) })).then(asJson),
    put: (path: string, body?: unknown) =>
      api.fetch(path, wrap({ method: 'PUT', body: JSON.stringify(body ?? {}) })).then(asJson),
    delete: (path: string) => api.fetch(path, wrap({ method: 'DELETE' })).then(asJson),
  } as unknown as TestClient
}

type Principal = 'Administrator' | 'System Manager' | 'access token'
const PRINCIPALS: Principal[] = ['Administrator', 'System Manager', 'access token']

async function as(who: Principal, ctx: { admin: TestClient; api: TestClient; createUser: (o: { roles: string[] }) => Promise<TestClient> }) {
  if (who === 'Administrator') return ctx.admin
  if (who === 'System Manager') return ctx.createUser({ roles: ['System Manager'] })
  return tokenClient(ctx.admin, ctx.api)
}

async function activityCount(): Promise<number> {
  const [{ n }] = await sql`select count(*)::int as n from activity_log`
  return Number(n)
}

describe('#432: every privileged principal is refused on an audit table', () => {
  for (const who of PRINCIPALS) {
    describe(who, () => {
      test('insert, through the row API and save_row', async ({ admin, api, createUser }) => {
        const client = await as(who, { admin, api, createUser })
        const before = await activityCount()
        await expectApiError(client.post(`/api/table/${ENC}`, { user: 'Administrator', operation: 'forged login' }), REFUSED)
        await expectApiError(client.post('/api/save_row', { table: AL, row: { user: 'Administrator', operation: 'forged' } }), REFUSED)
        expect(await activityCount()).toBe(before)
      })

      test('update', async ({ admin, api, createUser }) => {
        const id = await seedActivity()
        const client = await as(who, { admin, api, createUser })
        await expectApiError(patchDoc(client, `/api/table/${ENC}/${id}`, { operation: 'rewritten' }), REFUSED)
        await expectApiError(client.post('/api/save_row', { table: AL, row: { row_id: id, operation: 'rewritten' } }), REFUSED)
        const [row] = await sql`select operation from activity_log where row_id = ${id}`
        expect(row.operation).toBe('seeded for #432')
      })

      test('delete, one row and a bulk selection', async ({ admin, api, createUser }) => {
        const ids = [await seedActivity('first'), await seedActivity('second')]
        const client = await as(who, { admin, api, createUser })
        // The list's bulk delete sends one delete per selected row.
        for (const id of ids) await expectApiError(client.delete(`/api/table/${ENC}/${id}`), REFUSED)
        expect(await sql`select row_id from activity_log where row_id in ${sql(ids)}`).toHaveLength(2)
      })

      test('rename', async ({ admin, api, createUser }) => {
        const id = await seedActivity()
        const client = await as(who, { admin, api, createUser })
        await expectApiError(client.post(`/api/table/${ENC}/${id}:rename`, { new_name: 'forged-id' }), REFUSED)
        expect(await sql`select 1 from activity_log where row_id = ${id}`).toHaveLength(1)
      })

      test('import and merge (a merge is an import into the target), dry run included', async ({ admin, api, createUser }) => {
        const client = await as(who, { admin, api, createUser })
        const before = await activityCount()
        const rows = [{ user: 'Administrator', operation: 'imported forgery' }]
        await expectApiError(client.post(`/api/table/${ENC}:import`, { rows }), REFUSED)
        await expectApiError(client.post(`/api/table/${ENC}:import`, { rows, dry_run: true }), REFUSED)
        await expectApiError(client.post(`/api/table/${ENC}:import-revert`, { run_id: 'any' }), REFUSED)
        expect(await activityCount()).toBe(before)
      })

      test('column changes: schema, rename column, naming, custom field, delete table', async ({ admin, api, createUser }) => {
        const client = await as(who, { admin, api, createUser })
        const meta = await admin.get<{ columns: unknown[] }>(`/api/table/${ENC}:meta`)
        await expectApiError(
          client.put(`/api/table_def/${ENC}`, {
            columns: [...meta.columns, { column_name: 'forged_note', column_type: 'Data' }],
          }),
          REFUSED,
        )
        await expectApiError(client.post(`/api/table_def/${ENC}/rename_column`, { from: 'operation', to: 'op' }), REFUSED)
        await expectApiError(client.put(`/api/table_def/${ENC}/id_pattern`, { id_pattern: 'prompt' }), REFUSED)
        await expectApiError(
          client.post('/api/save_row', { table: 'Custom Field', row: { row_id: 'Activity Log-forged_flag', dt: AL, column_name: 'forged_flag', column_type: 'Check' } }),
          REFUSED,
        )
        await expectApiError(client.delete(`/api/table_def/${ENC}`), REFUSED)
        const after = await admin.get<{ columns: { column_name: string }[]; id_pattern: string }>(`/api/table/${ENC}:meta`)
        expect(after.columns.map((c) => c.column_name)).not.toContain('forged_note')
        expect(after.columns.map((c) => c.column_name)).not.toContain('forged_flag')
        expect(after.columns.map((c) => c.column_name)).toContain('operation')
        expect(after.id_pattern).not.toBe('prompt')
      })
    })
  }
})

describe('#432: the flag', () => {
  test('is set on exactly the server-written platform tables and exposed on the table meta', async ({ admin }) => {
    const flagged = await sql`select name from table_def where system_written order by name`
    expect(flagged.map((r) => r.name)).toEqual(SYSTEM_WRITTEN)
    expect(await admin.get(`/api/table/${ENC}:meta`)).toMatchObject({ system_written: true })
    expect(await admin.get('/api/table/Comment:meta')).toMatchObject({ system_written: false })
  })

  test('every flagged table refuses create, update and delete — before any existence check', async ({ admin }) => {
    for (const table of SYSTEM_WRITTEN) {
      const enc = encodeURIComponent(table)
      await expectApiError(admin.post(`/api/table/${enc}`, {}), REFUSED)
      await expectApiError(patchDoc(admin, `/api/table/${enc}/no-such-row`, {}), REFUSED)
      await expectApiError(admin.delete(`/api/table/${enc}/no-such-row`), REFUSED)
    }
  })

  test('a person-built table can never claim the flag', async ({ admin }) => {
    await makeTable(admin, { name: 'Claims Audit', columns: ['title'], system_written: true })
    expect(await admin.get('/api/table/Claims%20Audit:meta')).toMatchObject({ system_written: false })
    await admin.post('/api/table/Claims%20Audit', { title: 'ordinary row' })
  })

  test('a grant on an audit table never makes it creatable', async ({ admin, createUser }) => {
    await grantRole(admin, { role: 'Audit Writer', table: AL, can_read: true, can_create: true, can_write: true, can_delete: true })
    const user = await createUser({ roles: ['Audit Writer'] })
    const boot = await user.get<{ capabilities: { creatable: string[]; tables: string[] } }>('/api/whoami')
    expect(boot.capabilities.creatable).not.toContain(AL)
    expect(boot.capabilities.tables).toContain(AL)
    await expectApiError(user.post(`/api/table/${ENC}`, { user: user.user, operation: 'forged' }), REFUSED)
  })
})

describe('#432: the server still writes, and everyone still reads', () => {
  test('signing in records an activity', async ({ admin, api }) => {
    const person = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { email: 'audit-signin@x.com' } })
    await setUserPassword(person.row_id, 'auditpw123')
    const res = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'audit-signin@x.com', pwd: 'auditpw123' }) })
    expect(res.status).toBe(200)
    const rows = await sql`select operation from activity_log where "user" = ${person.row_id}`
    expect(rows.map((r) => r.operation)).toContain('login')
  })

  test('the job runner records the job and its execution', async () => {
    await loadJobs()
    const job = await enqueue('ping_job', {})
    // now() is frozen at BEGIN inside the sandbox while run_at is wall-clock
    // (same shim as jobs.test.ts): make the job due by the transaction clock.
    await sql`update background_job set run_at = now() where row_id = ${job}`
    await drainJobs()
    const [bj] = await sql`select job_status from background_job where row_id = ${job}`
    expect(bj.job_status).toBe('done')
    expect(await sql`select 1 from job_execution where job = ${job}`).not.toHaveLength(0)
  })

  test('an import into an ordinary table still writes its Import Log', async ({ admin }) => {
    await makeTable(admin, { name: 'Audit Import Target', columns: ['title'] })
    await admin.post('/api/table/Audit%20Import%20Target:import', { rows: [{ title: 'one' }] })
    const logs = await sql`select inserted from import_log where ref_table = 'Audit Import Target'`
    expect(logs.map((l) => Number(l.inserted))).toEqual([1])
  })

  test('saving a tracked row still writes its Version', async ({ admin }) => {
    await makeTable(admin, { name: 'Audit Tracked', columns: ['title'], track_changes: true })
    const row = await admin.post<{ row_id: string; updated_at: string }>('/api/table/Audit%20Tracked', { title: 'a' })
    await patchDoc(admin, `/api/table/Audit%20Tracked/${row.row_id}`, { title: 'b', updated_at: row.updated_at })
    expect(await sql`select 1 from version where ref_table = 'Audit Tracked' and ref_name = ${row.row_id}`).not.toHaveLength(0)
  })

  test('a failed job can still be retried through its dedicated action', async ({ admin }) => {
    await loadJobs()
    await sql`insert into background_job ${sql({ row_id: 'audit-failed-job', created_by: 'Administrator', updated_by: 'Administrator', method: 'ping_job', job_status: 'failed', attempts: 3, max_attempts: 3, payload: '{}' })}`
    await admin.post('/api/retry_job', { row_id: 'audit-failed-job' })
    const [job] = await sql`select job_status from background_job where row_id = 'audit-failed-job'`
    expect(job.job_status).toBe('queued')
  })

  test('reads are unchanged: list, row and meta', async ({ admin, createUser }) => {
    const id = await seedActivity()
    const sm = await createUser({ roles: ['System Manager'] })
    for (const client of [admin, sm]) {
      const list = await client.get<{ data: { row_id: string }[] }>(`/api/table/${ENC}?limit_page_length=500`)
      expect(list.data.map((r) => r.row_id)).toContain(id)
      expect(await client.get(`/api/table/${ENC}/${id}`)).toMatchObject({ row_id: id, operation: 'seeded for #432' })
    }
  })
})

// Completeness: the guard has to hold on every way in, including ways added
// after this test. Each list below is enumerated from the running code, so a
// new entry point fails here until it is classified.
describe('#432: every write entry point is covered', () => {
  test('every write-effect row and collection action is refused on an audit table', async ({ admin }) => {
    const id = await seedActivity()
    const { row, collection } = listActions()
    const writes = [...row, ...collection].filter((a) => a.effect === 'write')
    expect(writes.length).toBeGreaterThan(0)
    for (const a of collection.filter((x) => x.effect === 'write'))
      await expectApiError(admin.post(`/api/table/${ENC}:${a.action}`, {}), REFUSED)
    for (const a of row.filter((x) => x.effect === 'write'))
      await expectApiError(admin.post(`/api/table/${ENC}/${id}:${a.action}`, {}), REFUSED)
  })

  // Every exported function of the document engine is either a reader, the
  // trusted internal writer, or a public writer that refuses audit tables.
  const READERS = ['assertUserPermissions', 'checkRowForInsert', 'getDoc', 'validateRowForUpdate']
  const TRUSTED = ['saveSystemRow']
  const PUBLIC_WRITERS: Record<string, (id: string) => Promise<unknown>> = {
    saveDoc: () => documentModule.saveDoc(AL, { user: 'Administrator', operation: 'forged' }),
    deleteDoc: (id) => documentModule.deleteDoc(AL, id),
    renameDoc: (id) => documentModule.renameDoc(AL, id, 'forged-id'),
    submitDoc: (id) => documentModule.submitDoc(AL, id),
    cancelDoc: (id) => documentModule.cancelDoc(AL, id),
    amendDoc: (id) => documentModule.amendDoc(AL, id),
    saveSingle: () => documentModule.saveSingle(AL, {}),
  }

  test('every exported document-engine writer is classified and refuses as Administrator', async () => {
    const exported = Object.entries(documentModule)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .sort()
    expect(exported).toEqual([...READERS, ...TRUSTED, ...Object.keys(PUBLIC_WRITERS)].sort())
    const id = await seedActivity()
    for (const [name, call] of Object.entries(PUBLIC_WRITERS))
      await expect(call(id), name).rejects.toMatchObject({ type: 'PermissionError', message: expect.stringMatching(/written only by the platform/) })
  })

  test('the trusted writer still inserts into an audit table', async () => {
    const saved = await documentModule.saveSystemRow('Import Log', { ref_table: 'Person', inserted: 0, updated: 0, failed: 0 }, 'Administrator')
    expect(await sql`select 1 from import_log where row_id = ${String(saved.row_id)}`).toHaveLength(1)
  })

  // Every state-changing HTTP route, classified. "row" and "structure" routes
  // are exercised above; the rest never write an audit table's rows or columns.
  const ROUTES: Record<string, 'row' | 'structure' | string> = {
    'POST /api/table/:table': 'row',
    'POST /api/table/:table/:name': 'row',
    'PATCH /api/table/:table/:name': 'row',
    'DELETE /api/table/:table/:name': 'row',
    'POST /api/save_row': 'row',
    'PUT /api/table_def/:name': 'structure',
    'PUT /api/table_def/:name/id_pattern': 'structure',
    'POST /api/table_def/:name/rename_column': 'structure',
    'DELETE /api/table_def/:name': 'structure',
    'POST /api/import_customizations': 'structure — custom fields go through the guarded save',
    'POST /api/reapply_custom_fields': 'structure — re-applies existing custom fields only',
    'POST /api/import/batches/:id/delete_tables': 'structure — deletes person-built tables; audit tables are system tables',
    'POST /api/table_def': 'creates a new table; cannot claim the flag',
    'POST /api/tenancy/table_def': 'creates a table on another site',
    'POST /api/login': 'internal writer: records the sign-in',
    'POST /api/login/delegated': 'internal writer: records the sign-in',
    'POST /api/signup': 'creates a person',
    'POST /api/logout': 'internal writer: records the sign-out',
    'POST /api/reset_password_request': 'password reset',
    'POST /api/reset_password': 'password reset',
    'POST /api/web_form/:route': 'web form insert through the guarded save',
    'POST /api/method/:path{.+}': 'server methods write through the guarded save',
    'POST /api/oauth/session': 'sign-in',
    'POST /api/sales_target/embed_session': 'sign-in',
    'POST /api/events': 'internal writer: the caller\'s own usage events',
    'POST /api/saved_views': 'saved views',
    'POST /api/saved_views/:name/share': 'saved views',
    'DELETE /api/saved_views/:name': 'saved views',
    'POST /api/set_theme': 'personal preference',
    'POST /api/set_palette': 'personal preference',
    'POST /api/set_language': 'personal preference',
    'POST /api/set_password': 'credentials',
    'POST /api/people/names': 'read',
    'POST /api/people/:id/identities': 'person identities',
    'POST /api/people/:id/identifiers': 'person identifiers',
    'PATCH /api/identifiers/:id': 'person identifiers',
    'DELETE /api/identifiers/:id': 'person identifiers',
    'PATCH /api/identities/:identityId': 'person identities',
    'DELETE /api/identities/:identityId': 'person identities',
    'DELETE /api/me/identities/:identityId': 'person identities',
    'DELETE /api/me/password': 'credentials',
    'POST /api/access_tokens': 'credentials',
    'DELETE /api/access_tokens/:id': 'credentials',
    'POST /api/service_accounts': 'service accounts',
    'PATCH /api/service_accounts/:name': 'service accounts',
    'POST /api/service_accounts/:id/roles': 'service accounts',
    'POST /api/access_log': 'internal writer: records the caller\'s own export',
    'POST /api/upload_file': 'creates a File row through the guarded save',
    'POST /api/dashboard/count': 'read',
    'POST /api/dashboard/chart': 'read',
    'POST /api/report_chart': 'read',
    'POST /api/pin_chart_to_dashboard': 'dashboards',
    'POST /api/permissions/:table': 'grants; a grant never makes an audit table writable',
    'POST /api/run_query_report': 'read',
    'POST /api/tenancy/sites': 'tenancy',
    'POST /api/tenancy/user': 'tenancy',
    'POST /api/app_actions/:app/:action': 'app actions refuse system tables',
    'POST /api/app_reads/:app/:read': 'read',
    'POST /api/preview_app_upgrade': 'app lifecycle',
    'POST /api/upgrade_app': 'app lifecycle',
    'POST /api/activate_app_upgrade': 'app lifecycle',
    'POST /api/set_app_enabled': 'app lifecycle',
    'POST /api/install_app': 'app lifecycle',
    'POST /api/uninstall_app': 'app lifecycle',
    'POST /api/run_auto_email_report': 'internal writer: queues email',
    'POST /api/run_script_report': 'read',
    'POST /api/server_script/:method': 'server scripts write through the guarded save',
    'PUT /api/user_settings/:table': 'personal preference',
    'POST /api/assign': 'creates a ToDo; the assigned row is not changed',
    'POST /api/tags': 'tags live beside the row; the row is not changed',
    'DELETE /api/tags/:table/:name/:tag': 'tags live beside the row; the row is not changed',
    'POST /api/send_test_email': 'internal writer: dedicated email action',
    'POST /api/queue_email': 'internal writer: dedicated email action',
    'POST /api/enqueue_job': 'internal writer: dedicated job action',
    'POST /api/retry_job': 'internal writer: dedicated job action',
  }

  test('every state-changing HTTP route is classified', () => {
    const routes = [
      ...new Set(
        app.routes
          .filter((r) => !['GET', 'ALL', 'OPTIONS', 'HEAD'].includes(r.method))
          .map((r) => `${r.method} ${r.path}`),
      ),
    ].sort()
    expect(routes).toEqual(Object.keys(ROUTES).sort())
  })
})

// Review round 1 (#441): writes triggered as side effects of other Tables.
describe('#432: configurable automation never reaches a system-written table', () => {
  async function importOne(admin: TestClient) {
    await makeTable(admin, { name: 'Audit Side Target', columns: ['title'] })
    await admin.post('/api/table/Audit%20Side%20Target:import', { rows: [{ title: 'one' }] })
    return sql`select inserted, failed, error_summary from import_log where ref_table = 'Audit Side Target'`
  }

  // Rows written straight into the store stand for configuration that
  // pre-dates the flag; the API now refuses to create them (below).
  test('a Document Event script on the Import Log can neither rewrite nor drop the log', async ({ admin }) => {
    await sql`insert into server_script ${sql({ row_id: 'forge-import-log', script_type: 'Document Event', ref_table: 'Import Log', event: 'before_save', script: 'doc.inserted = 999', enabled: true })}`
    await sql`insert into server_script ${sql({ row_id: 'drop-import-log', script_type: 'Document Event', ref_table: 'Import Log', event: 'validate', script: 'throw new Error("drop it")', enabled: true })}`
    const logs = await importOne(admin)
    expect(logs.map((l) => Number(l.inserted))).toEqual([1])
  })

  test('a Metadata Override cannot block, default or hide an audit column', async ({ admin }) => {
    await sql`insert into metadata_override ${sql({ row_id: 'mo-reqd', table_name: 'Import Log', column_name: 'file_name', property: 'reqd', value: '1' })}`
    await sql`insert into metadata_override ${sql({ row_id: 'mo-default', table_name: 'Import Log', column_name: 'sheet_name', property: 'default_value', value: 'forged' })}`
    await sql`insert into metadata_override ${sql({ row_id: 'mo-hidden', table_name: AL, column_name: 'operation', property: 'hidden', value: '1' })}`
    const logs = await importOne(admin)
    expect(logs.map((l) => Number(l.inserted))).toEqual([1])
    expect(await sql`select sheet_name from import_log where ref_table = 'Audit Side Target'`).toEqual([{ sheet_name: null }])
    const meta = await admin.get<{ columns: { column_name: string; hidden: boolean }[] }>(`/api/table/${ENC}:meta`)
    expect(meta.columns.find((c) => c.column_name === 'operation')?.hidden).toBe(false)
  })

  test('Server Scripts, Metadata Overrides, Workflows and Custom Fields cannot target an audit table', async ({ admin }) => {
    await expectApiError(admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'forge', script_type: 'Document Event', ref_table: AL, event: 'validate', script: 'doc.x = 1', enabled: true } }), REFUSED)
    await expectApiError(admin.post('/api/save_row', { table: 'Metadata Override', row: { row_id: 'mo-forge', table_name: AL, column_name: 'operation', property: 'hidden', value: '1' } }), REFUSED)
    await expectApiError(admin.post('/api/save_row', { table: 'Workflow', row: { row_id: 'forge-wf', ref_table: AL, is_active: true, states: [{ state: 'Open', target_status: 'draft' }] } }), REFUSED)
    expect((await admin.get<{ columns: { column_name: string }[] }>(`/api/table/${ENC}:meta`)).columns.map((c) => c.column_name)).not.toContain('workflow_state')
  })

  test('an existing Custom Field on an audit table cannot be deleted (it would drop a column)', async ({ admin }) => {
    await sql`insert into custom_field ${sql({ row_id: 'Activity Log-legacy_note', dt: AL, column_name: 'legacy_note', column_type: 'Data' })}`
    await expectApiError(admin.delete('/api/table/Custom%20Field/Activity%20Log-legacy_note'), REFUSED)
    expect(await sql`select 1 from custom_field where row_id = 'Activity Log-legacy_note'`).toHaveLength(1)
  })

  test('deleting a Table keeps its history', async ({ admin }) => {
    await makeTable(admin, { name: 'Audit Doomed', columns: ['title'], track_changes: true })
    const row = await admin.post<{ row_id: string; updated_at: string }>('/api/table/Audit%20Doomed', { title: 'a' })
    await patchDoc(admin, `/api/table/Audit%20Doomed/${row.row_id}`, { title: 'b', updated_at: row.updated_at })
    await admin.post('/api/table/Audit%20Doomed:import', { rows: [{ title: 'c' }] })
    const [version] = await sql`select row_id from version where ref_table = 'Audit Doomed' limit 1`
    const [log] = await sql`select row_id from import_log where ref_table = 'Audit Doomed'`
    await admin.delete('/api/table_def/Audit%20Doomed')
    expect(await admin.get(`/api/table/Version/${version.row_id}`)).toMatchObject({ ref_table: 'Audit Doomed' })
    expect(await admin.get(`/api/table/Import%20Log/${log.row_id}`)).toMatchObject({ ref_table: 'Audit Doomed' })
  })

  test('history kept for a deleted Table never acts on a namesake created later', async ({ admin }) => {
    await makeTable(admin, { name: 'Audit Namesake', columns: ['title'] })
    await admin.post('/api/table/Audit%20Namesake:import', {
      rows: [{ title: 'old' }],
      context: { batch_id: 'namesake-batch', run_id: 'namesake-run', table_created: true },
    })
    await admin.delete('/api/table_def/Audit%20Namesake')
    // Re-created by hand, later, under the same name. (The test runs in one
    // transaction, where now() never moves, so the later creation is stamped
    // with the wall clock.)
    await makeTable(admin, { name: 'Audit Namesake', columns: ['title'] })
    await sql`update table_def set created_at = clock_timestamp() + interval '1 second' where name = 'Audit Namesake'`
    const fresh = await admin.post<{ row_id: string }>('/api/table/Audit%20Namesake', { title: 'new' })
    // The old batch does not claim the new Table, so deleting it leaves it be.
    expect(await admin.post('/api/import/batches/namesake-batch/delete_tables', {})).toEqual({ deleted: [], refused: [] })
    expect(await admin.get('/api/table/Audit%20Namesake:meta')).toMatchObject({ name: 'Audit Namesake' })
    // The old run does not revert into the new Table.
    await expectApiError(admin.post('/api/table/Audit%20Namesake:import-revert', { run_id: 'namesake-run' }), { status: 404 })
    expect(await admin.get(`/api/table/Audit%20Namesake/${fresh.row_id}`)).toMatchObject({ title: 'new' })
  })

  // Every column anywhere that names a Table is a way for one Table's save to
  // act on another. Each is classified: refused when it names an audit table,
  // or why it can never write one.
  const TARGETING: Record<string, string> = {
    'Custom Field.dt': 'refused',
    'Metadata Override.table_name': 'refused',
    'Server Script.ref_table': 'refused',
    'Workflow.ref_table': 'refused',
    'Assignment Rule.ref_table': 'runs after a public save, which audit tables never get',
    'Email Rule.ref_table': 'runs after a public save or submit, which audit tables never get',
    'Service Level Agreement.ref_table': 'stamps a row during a public save, which audit tables never get',
    'Webhook.webhook_table': 'fires after a public save, which audit tables never get; reads only',
    'Web Form.ref_table': 'inserts through the guarded public save',
    'Client Script.ref_table': 'runs in the browser on forms that are read-only here',
    'Print Format.ref_table': 'reads only',
    'Report.ref_table': 'reads only',
    'Permission.ref_table': 'grants; a grant never makes an audit table writable',
    'Data Scope.allow_table': 'narrows reads',
    'Share.share_table': 'grants read on one row; never writable',
    'Home Page Link.link_to': 'navigation',
    'Comment.ref_table': 'lives beside the row',
    'File.ref_table': 'lives beside the row',
    'ToDo.ref_table': 'lives beside the row',
    'Workflow Action.ref_table': 'workflow log; workflow steps are refused on audit tables',
  }

  test('every column that can point at a Table is classified', async () => {
    const rows = await sql<{ ref: string }[]>`
      select cd.parent || '.' || cd.column_name as ref from column_def cd
      join table_def td on td.name = cd.parent
      where cd.column_type = 'Reference' and cd.reference_table = 'Table' and not td.system_written`
    expect(rows.map((r) => r.ref).sort()).toEqual(Object.keys(TARGETING).sort())
  })
})

// Review round 2 (#441): history is dated by the database clock, and history
// kept for a deleted Table never attaches to a namesake created later.
describe('#432: kept history and the database clock', () => {
  // The later namesake is stamped by the wall clock: inside the sandbox
  // transaction now() never moves.
  async function recreateLater(admin: TestClient, name: string) {
    await makeTable(admin, { name, columns: ['title'], id_pattern: 'prompt', track_changes: true })
    await sql`update table_def set created_at = clock_timestamp() + interval '1 second' where name = ${name}`
  }

  test('an import stays revertible when the app clock runs behind the database', async ({ admin }) => {
    await makeTable(admin, { name: 'Audit Skew', columns: ['title'] })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() - 60 * 60 * 1000)
    // Called in-process: a skewed clock would also expire the HTTP session.
    try {
      await getCollectionAction('import')!.handler({
        table: 'Audit Skew',
        args: { rows: [{ title: 'one' }], context: { run_id: 'skew-run' } },
        user: { row_id: 'Administrator' } as never,
      })
    } finally {
      vi.useRealTimers()
    }
    expect(await admin.post('/api/table/Audit%20Skew:import-revert', { run_id: 'skew-run' })).toMatchObject({ deleted: 1 })
  })

  test("a re-created Table's row does not inherit the deleted Table's change history", async ({ admin }) => {
    await makeTable(admin, { name: 'Audit Reborn', columns: ['title'], id_pattern: 'prompt', track_changes: true })
    const old = await admin.post<{ updated_at: string }>('/api/table/Audit%20Reborn', { row_id: 'R-1', title: 'old a' })
    await patchDoc(admin, '/api/table/Audit%20Reborn/R-1', { title: 'old b', updated_at: old.updated_at })
    const filters = encodeURIComponent(JSON.stringify([['ref_table', '=', 'Audit Reborn'], ['ref_name', '=', 'R-1']]))
    const history = () => admin.get<{ data: unknown[] }>(`/api/table/Version?filters=${filters}`)
    expect((await history()).data).toHaveLength(1)
    await admin.delete('/api/table_def/Audit%20Reborn')
    // Kept, and still listed, while no namesake exists.
    expect((await history()).data).toHaveLength(1)
    await recreateLater(admin, 'Audit Reborn')
    await admin.post('/api/table/Audit%20Reborn', { row_id: 'R-1', title: 'new' })
    expect((await history()).data).toHaveLength(0)
  })

  test('the namesake rule is an anti-join with the same results as a per-row check', async ({ admin }) => {
    const { scopedWhere } = await import('../src/query')
    await makeTable(admin, { name: 'Audit Plan', columns: ['title'], id_pattern: 'prompt', track_changes: true })
    for (const id of ['P-1', 'P-2']) {
      const r = await admin.post<{ updated_at: string }>('/api/table/Audit%20Plan', { row_id: id, title: 'a' })
      await patchDoc(admin, `/api/table/Audit%20Plan/${id}`, { title: 'b', updated_at: r.updated_at })
    }
    await admin.delete('/api/table_def/Audit%20Plan')
    await recreateLater(admin, 'Audit Plan')
    const { table, where } = await scopedWhere('Version', 'Administrator', [])
    const [{ n }] = await sql`select count(*)::int as n from ${sql(table)} where ${where}`
    // The reference formulation: a row is hidden only when its Table name
    // was created after it was written.
    const [{ expected }] = await sql`
      select count(*)::int as expected from version v
      where v.created_at >= coalesce((select td.created_at from table_def td where td.name = v.ref_table), '-infinity'::timestamptz)`
    expect(n).toBe(expected)
    expect(await sql`select 1 from version where ref_table = 'Audit Plan'`).toHaveLength(2)
    const visible = await admin.get<{ data: unknown[] }>(
      `/api/table/Version?filters=${encodeURIComponent(JSON.stringify([['ref_table', '=', 'Audit Plan']]))}`,
    )
    expect(visible.data).toHaveLength(0)
    const plan = (await sql`explain select count(*) from ${sql(table)} where ${where}`).map((r) => String(r['QUERY PLAN'])).join('\n')
    expect(plan).toMatch(/Anti Join/)
    expect(plan).not.toMatch(/SubPlan/)
  })

  test('an email queued for a deleted Table fails rather than render its namesake', async ({ admin }) => {
    await loadJobs()
    await makeTable(admin, { name: 'Audit Mail', columns: ['title'], id_pattern: 'prompt' })
    await admin.post('/api/table/Audit%20Mail', { row_id: 'M-1', title: 'old secret' })
    const queued = await queueEmail({ to: 'audit@example.test', subject: 'About {{ doc.title }}', body: '{{ doc.title }}', ref_table: 'Audit Mail', reference_name: 'M-1', render: true })
    await admin.delete('/api/table_def/Audit%20Mail')
    await makeTable(admin, { name: 'Audit Mail', columns: ['title'], id_pattern: 'prompt' })
    await sql`update table_def set created_at = clock_timestamp() + interval '1 second' where name = 'Audit Mail'`
    await admin.post('/api/table/Audit%20Mail', { row_id: 'M-1', title: 'new private' })
    await sql`update background_job set run_at = now() where job_status = 'queued'`
    await drainJobs().catch(() => {})
    const [row] = await sql`select send_status, error from email_queue where row_id = ${queued}`
    expect(row).toMatchObject({ send_status: 'error', error: expect.stringMatching(/Audit Mail was deleted/) })
    expect(await sql`select 1 from email_sink where subject like '%new private%'`).toHaveLength(0)
  })
})

// Review round 3 (#441): what a Table reaches is decided by the storage it
// resolves to, and no route reaches platform storage from the side: not
// through an alias, a Data Source or a script.
describe('#432: storage decides, not the name', () => {
  test('no Table of any kind or letter case may resolve to storage another Table owns', async ({ admin }) => {
    const CLASH = { status: 409, type: 'ConflictError' }
    for (const [name, kind] of [
      ['activity log', 'settings'],
      ['ACTIVITY  LOG', 'settings'],
      ['activity log', 'table'],
      ['Activity log', 'sub_table'],
    ] as const)
      await expectApiError(admin.post('/api/table_def', { name, kind, columns: [{ column_name: 'note', column_type: 'Data' }] }), CLASH)
    // An ordinary Table's storage is owned just the same, even by a Settings Table.
    await makeTable(admin, { name: 'Audit Owned', kind: 'settings', columns: ['note'] })
    await expectApiError(admin.post('/api/table_def', { name: 'audit owned', columns: [{ column_name: 'note', column_type: 'Data' }] }), CLASH)
    expect(await sql`select name from table_def where lower(name) in ('activity log', 'audit owned') order by name`).toEqual([
      { name: 'Activity Log' },
      { name: 'Audit Owned' },
    ])
  })

  test('a Table that resolves to an audit table is system-written, whatever its own definition says', async ({ admin }) => {
    // Written straight into the store: an alias that pre-dates the refusal above.
    await sql`insert into table_def ${sql({ name: 'activity log', module: 'Core', kind: 'settings' })}`
    await sql`insert into column_def ${sql({ parent: 'activity log', position: 1, column_name: 'operation', label: 'operation', column_type: 'Data' })}`
    const victim = await seedActivity('alias target')
    expect(await getMeta('activity log')).toMatchObject({ system_written: true })
    await expectApiError(admin.post('/api/save_row', { table: 'Workflow', row: { row_id: 'alias-wf', ref_table: 'activity log', state_field: 'operation', is_active: true, states: [{ state: 'Open', target_status: 'draft' }] } }), REFUSED)
    await expect(applyWorkflowAction('activity log', victim, 'Approve', 'Administrator')).rejects.toThrow(/written only by the platform/)
    await expect(ensureStateField('activity log')).rejects.toThrow(/written only by the platform/)
    expect(await sql`select operation from activity_log where row_id = ${victim}`).toEqual([{ operation: 'alias target' }])
  })
})

describe('#432: a Data Source never reaches platform storage', () => {
  const PLATFORM_DB = { status: 403, type: 'PermissionError', message: expect.stringMatching(/platform's own database/) }

  async function saveSource(admin: TestClient, row: Record<string, unknown>) {
    invalidateSources()
    return admin.post('/api/table/Data%20Source', { engine: 'postgres', access: 'read_write', ...row })
  }

  test("a Data Source on the platform's own connection is refused when saved", async ({ admin }) => {
    process.env.AUDIT_SAME_URL = config.databaseUrl
    await expectApiError(saveSource(admin, { row_id: 'audit-own-db', url_env: 'DATABASE_URL' }), PLATFORM_DB)
    await expectApiError(saveSource(admin, { row_id: 'audit-own-db', url_env: 'AUDIT_SAME_URL' }), PLATFORM_DB)
    expect(await sql`select 1 from data_source where row_id = 'audit-own-db'`).toHaveLength(0)
  })

  test("any other URL to the platform's own database is refused when it connects", async ({ admin }) => {
    // Same server, same database, a different spelling of the URL.
    const alias = new URL(config.databaseUrl)
    alias.hostname = alias.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
    process.env.AUDIT_ALIAS_URL = alias.toString()
    await saveSource(admin, { row_id: 'audit-alias-db', url_env: 'AUDIT_ALIAS_URL', default_schema: 'public' })
    const tested = await admin.post<{ ok: boolean; error?: string }>('/api/table/Data%20Source/audit-alias-db:test_connection', {})
    expect(tested).toMatchObject({ ok: false, error: expect.stringMatching(/platform's own database/) })
    await expectApiError(
      admin.post('/api/table/Data%20Source/audit-alias-db:reflect', { schema: 'public', tables: ['site'] }),
      PLATFORM_DB,
    )
    invalidateSources()
  })

  test('no Table may be bound to a relation in the platform schema, on any database', async ({ admin }) => {
    const ext = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
    try {
      await ext.unsafe(`create schema if not exists featherbase;
        create table if not exists featherbase.activity_log (row_id text primary key, operation text)`)
      process.env.AUDIT_EXT_URL = EXTERNAL_DATABASE_URL
      await saveSource(admin, { row_id: 'audit-ext', url_env: 'AUDIT_EXT_URL' })
      const binding = { data_source: 'audit-ext', external_schema: 'featherbase', external_table: 'activity_log', external_pk: 'row_id' }
      await expectApiError(
        admin.post('/api/table_def', { name: 'Audit Bound Log', ...binding, columns: [{ column_name: 'operation', column_type: 'Data' }] }),
        { status: 403, type: 'PermissionError', message: expect.stringMatching(/platform schema/) },
      )
      // A binding that pre-dates the rule is refused at use.
      await sql`insert into table_def ${sql({ name: 'Audit Bound Log', module: 'Core', kind: 'table', ...binding })}`
      await expectApiError(admin.get('/api/table/Audit%20Bound%20Log'), { status: 403, type: 'PermissionError' })
    } finally {
      await ext.unsafe('drop schema if exists featherbase cascade')
      await ext.end({ timeout: 2 })
      invalidateSources()
    }
  })
})

describe('#432: the Workflow target is checked on the row that is saved', () => {
  test('a before_save script that retargets a Workflow onto an audit table is refused', async ({ admin }) => {
    await makeTable(admin, { name: 'Audit WF Target', columns: ['title'] })
    await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'retarget-wf', script_type: 'Document Event', ref_table: 'Workflow', event: 'before_save', script: 'doc.ref_table = "Activity Log"', enabled: true } })
    await expectApiError(admin.post('/api/save_row', { table: 'Workflow', row: { row_id: 'retargeted-wf', ref_table: 'Audit WF Target', is_active: true, states: [{ state: 'Open', target_status: 'draft' }] } }), REFUSED)
    expect((await admin.get<{ columns: { column_name: string }[] }>(`/api/table/${ENC}:meta`)).columns.map((c) => c.column_name)).not.toContain('workflow_state')
    await expect(ensureStateField(AL)).rejects.toThrow(/written only by the platform/)
  })
})

describe('#432: every queued email about a deleted Table fails', () => {
  test('a plain queued email, with nothing to render, is not sent once its Table is gone', async ({ admin }) => {
    await loadJobs()
    await makeTable(admin, { name: 'Audit Plain Mail', columns: ['title'], id_pattern: 'prompt' })
    await admin.post('/api/table/Audit%20Plain%20Mail', { row_id: 'P-1', title: 'one' })
    const queued = await queueEmail({ to: 'audit@example.test', subject: 'Plain about P-1', body: 'fixed text', ref_table: 'Audit Plain Mail', reference_name: 'P-1' })
    await admin.delete('/api/table_def/Audit%20Plain%20Mail')
    await sql`update background_job set run_at = now() where job_status = 'queued'`
    await drainJobs().catch(() => {})
    const [row] = await sql`select send_status, error from email_queue where row_id = ${queued}`
    expect(row).toMatchObject({ send_status: 'error', error: expect.stringMatching(/Audit Plain Mail was deleted/) })
    expect(await sql`select 1 from email_sink where subject = 'Plain about P-1'`).toHaveLength(0)
  })
})
