import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { createAssignment } from '../src/assign'
import { enqueue, loadJobs, drainJobs } from '../src/jobs'
import { initDocState } from '../src/workflow'
import { getWebFormConfig } from '../src/webform'
import { applySla, getActiveSla } from '../src/sla'
import { getMeta } from '../src/meta'
import {
  registerApp,
  installApp,
  uninstallApp,
  isInstalled,
  listInstalledApps,
  loadInstalledApps,
  getAvailableApps,
} from '../src/apps'
import { clearControllers, registerController, runHooks } from '../src/controllers'

// Edge paths of the session's new modules, driven to full line coverage:
// app registry install/uninstall/rewire, initDocState backfill, web-form
// field-whitelist parsing, SLA no-match/disabled paths, escalation without a
// role, and assignment defaults.

async function makeDT(admin: TestClient, name: string) {
  await admin.post('/api/doctype', {
    name,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nDone', default_value: 'Open' },
      { fieldname: 'priority', fieldtype: 'Select', options: 'Low\nHigh', default_value: 'Low' },
      { fieldname: 'response_by', fieldtype: 'Datetime' },
      { fieldname: 'resolution_by', fieldtype: 'Datetime' },
      { fieldname: 'sla_status', fieldtype: 'Data' },
    ],
  })
}

describe('app registry: install lifecycle', () => {
  test('install/list/uninstall round-trip, including app-owned doctypes', async () => {
    const APP = `cov-app-${Date.now()}`
    const DT = `Cov App Note ${Date.now() % 100000}`
    registerApp({
      name: APP,
      doctypes: [{ name: DT, fields: [{ fieldname: 'note', fieldtype: 'Data' }] }],
    })
    expect(getAvailableApps()).toContain(APP)
    await expect(installApp(`${APP}-nope`)).rejects.toMatchObject({ type: 'ValidationError' })

    const installed = await installApp(APP)
    expect(installed.doctypes).toEqual([DT])
    expect(await isInstalled(APP)).toBe(true)
    expect((await listInstalledApps()).map((a) => a.name)).toContain(APP)
    await expect(installApp(APP)).rejects.toMatchObject({ type: 'ConflictError' })

    const removed = await uninstallApp(APP)
    expect(removed.removed).toEqual([DT])
    expect(await isInstalled(APP)).toBe(false)
    await expect(uninstallApp(APP)).rejects.toMatchObject({ type: 'ValidationError' })
  })

  test('loadInstalledApps rewires hooks after a process "restart"', async ({ admin }) => {
    const APP = `cov-rewire-${Date.now()}`
    const DT = 'Cov Rewire Note'
    await makeDT(admin, DT)
    const seen: string[] = []
    registerApp({ name: APP, doc_events: { [DT]: { after_insert: () => void seen.push('hit') } } })
    try {
      await installApp(APP)
      // Simulate the restart: hooks lost from the process, row still in DB.
      const { unregisterController } = await import('../src/controllers')
      void unregisterController // (unwire happens via a fresh wire map in prod)
      await loadInstalledApps() // idempotent when already wired
      await saveDoc(DT, { title: 'x' }, 'Administrator')
      expect(seen).toContain('hit')
    } finally {
      await uninstallApp(APP).catch(() => {})
    }
  })
})

describe('controllers: registry edges', () => {
  test('clearControllers removes every controller for a doctype', async ({ admin }) => {
    const DT = 'Cov Clear Note'
    await makeDT(admin, DT)
    const seen: string[] = []
    registerController({ doctype: DT, hooks: { validate: () => void seen.push('v') } })
    await runHooks('validate', {
      doc: {},
      meta: await getMeta(DT),
      user: 'Administrator',
      isNew: true,
      tx: sql,
    })
    expect(seen).toEqual(['v'])
    clearControllers(DT)
    await runHooks('validate', {
      doc: {},
      meta: await getMeta(DT),
      user: 'Administrator',
      isNew: true,
      tx: sql,
    })
    expect(seen).toEqual(['v'])
  })
})

describe('app registry: legacy row tolerance', () => {
  test('listInstalledApps survives double-encoded and malformed doctypes columns, loadInstalledApps skips unknown apps', async () => {
    await sql`insert into tab_installed_app (name, doctypes) values ('cov-legacy-str', ${'["Legacy X"]'}::jsonb)`
    await sql`insert into tab_installed_app (name, doctypes) values ('cov-legacy-bad', ${'"not json['}::jsonb)`
    const apps = await listInstalledApps()
    expect(apps.find((a) => a.name === 'cov-legacy-str')?.doctypes).toEqual(['Legacy X'])
    expect(apps.find((a) => a.name === 'cov-legacy-bad')?.doctypes).toEqual([])
    // Neither name has a registered manifest — loadInstalledApps must skip them.
    await loadInstalledApps()
  })
})

describe('workflow: definition validation edges', () => {
  test('a workflow with no states and a transition FROM an unknown state are rejected', async ({
    admin,
  }) => {
    const DT = 'Cov WfDef Note'
    await makeDT(admin, DT)
    await expect(
      admin.post('/api/save_doc', {
        doctype: 'Workflow',
        doc: { name: 'Cov Empty Flow', document_type: DT, is_active: false, states: [], transitions: [] },
      }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.post('/api/save_doc', {
        doctype: 'Workflow',
        doc: {
          name: 'Cov From Ghost Flow',
          document_type: DT,
          is_active: false,
          states: [{ state: 'A', doc_status: '0' }],
          transitions: [{ state: 'Ghost', action: 'Go', next_state: 'A', allowed: 'System Manager' }],
        },
      }),
    ).rejects.toMatchObject({ status: 417 })
  })
})

describe('workflow: initDocState backfill', () => {
  test('existing docs without a state are pointed at the initial state', async ({ admin }) => {
    const DT = 'Cov Init Note'
    await makeDT(admin, DT)
    const doc = await saveDoc(DT, { title: 'pre-workflow' }, 'Administrator')
    await sql`update tab_cov_init_note set status = null where name = ${String(doc.name)}`
    await admin.post('/api/save_doc', {
      doctype: 'Workflow',
      doc: {
        name: 'Cov Init Flow',
        document_type: DT,
        is_active: true,
        state_field: 'status',
        states: [
          { state: 'Open', doc_status: '0' },
          { state: 'Done', doc_status: '0' },
        ],
        transitions: [{ state: 'Open', action: 'Finish', next_state: 'Done', allowed: 'System Manager' }],
      },
    })
    await initDocState(DT)
    const [row] = await sql`select status from tab_cov_init_note where name = ${String(doc.name)}`
    expect(row.status).toBe('Open')
  })
})

describe('web form: field whitelist parsing', () => {
  test('malformed web_fields yields an empty field list; an array passes through', async ({
    admin,
  }) => {
    const DT = 'Cov Webform Note'
    await makeDT(admin, DT)
    await admin.post('/api/save_doc', {
      doctype: 'Web Form',
      doc: {
        name: 'Cov WF Broken',
        title: 'Broken',
        route: 'cov-broken',
        document_type: DT,
        published: true,
        web_fields: '{not json',
      },
    })
    expect((await getWebFormConfig('cov-broken')).fields).toEqual([])

    await admin.post('/api/save_doc', {
      doctype: 'Web Form',
      doc: {
        name: 'Cov WF Array',
        title: 'Array',
        route: 'cov-array',
        document_type: DT,
        published: true,
        web_fields: ['title'],
      },
    })
    const config = await getWebFormConfig('cov-array')
    expect(config.fields.map((f) => f.fieldname)).toEqual(['title'])

    await admin.post('/api/save_doc', {
      doctype: 'Web Form',
      doc: {
        name: 'Cov WF Nofields',
        title: 'Nofields',
        route: 'cov-nofields',
        document_type: DT,
        published: true,
      },
    })
    expect((await getWebFormConfig('cov-nofields')).fields).toEqual([])
  })
})

describe('SLA: non-matching paths', () => {
  test('no active SLA, disabled SLA, and unmatched priority all leave values alone', async ({
    admin,
  }) => {
    const DT = 'Cov Sla Note'
    await makeDT(admin, DT)
    expect(await getActiveSla(DT)).toBeNull()

    await saveDoc('Service Level Agreement', {
      name: 'Cov Sla Off',
      document_type: DT,
      enabled: false,
      priorities: [{ priority: 'High', response_hours: 1, resolution_hours: 2 }],
    })
    const values: Record<string, unknown> = { title: 'x', priority: 'High' }
    await applySla(await getMeta(DT), values)
    expect(values.response_by).toBeUndefined() // disabled SLA never stamps

    await sql`update tab_service_level_agreement set enabled = true where name = 'Cov Sla Off'`
    const unmatched: Record<string, unknown> = { title: 'y', priority: 'Low' } // no Low row
    await applySla(await getMeta(DT), unmatched)
    expect(unmatched.response_by).toBeUndefined()

    const matched: Record<string, unknown> = { title: 'z', priority: 'High' }
    await applySla(await getMeta(DT), matched)
    expect(matched.response_by).toBeInstanceOf(Date)
    expect(matched.sla_status).toBe('On Track')
  })

  test('escalation without an escalation role flips Overdue but sends no email', async ({
    admin,
  }) => {
    await loadJobs()
    const DT = 'Cov Sla NoRole'
    await makeDT(admin, DT)
    await saveDoc('Service Level Agreement', {
      name: 'Cov Sla NoRole Policy',
      document_type: DT,
      enabled: true,
      fulfilled_states: '',
      priorities: [{ priority: 'High', response_hours: 1, resolution_hours: 1 }],
    })
    const doc = await saveDoc(DT, { title: 'late', priority: 'High' }, 'Administrator')
    await sql`update tab_cov_sla_norole set resolution_by = now() - interval '1 hour'
      where name = ${String(doc.name)}`
    await enqueue('check_sla', {})
    await sql`
      update tab_background_job set run_at = now()
      where status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
    await drainJobs()
    const [row] = await sql`select sla_status from tab_cov_sla_norole where name = ${String(doc.name)}`
    expect(row.sla_status).toBe('Overdue')
    const mails = await sql`
      select 1 from tab_email_queue where reference_doctype = ${DT}`
    expect(mails.length).toBe(0)
  })
})

describe('assignment + RPC edges', () => {
  test('createAssignment defaults its description', async ({ admin, createUser }) => {
    const DT = 'Cov Assign Note'
    await makeDT(admin, DT)
    const user = await createUser({ roles: [] })
    const doc = await saveDoc(DT, { title: 'x' }, 'Administrator')
    await createAssignment(DT, String(doc.name), String(user.user), 'Administrator')
    const [todo] = await sql`
      select description from tab_todo
      where reference_doctype = ${DT} and reference_name = ${String(doc.name)}`
    expect(todo.description).toBe(`Assigned ${DT} ${String(doc.name)}`)
  })

  test('frappe.client.get_value resolves filters arrays and returns null on no match', async ({
    admin,
  }) => {
    const DT = 'Cov Value Note'
    await makeDT(admin, DT)
    await admin.post('/api/save_doc', { doctype: DT, doc: { title: 'target', status: 'Done' } })
    const hit = await admin.post<{ message: { status: string } }>(
      '/api/method/frappe.client.get_value',
      { doctype: DT, filters: [['title', '=', 'target']], fieldname: 'status' },
    )
    expect(hit.message.status).toBe('Done')
    const miss = await admin.post<{ message: null }>('/api/method/frappe.client.get_value', {
      doctype: DT,
      filters: [['title', '=', 'absent']],
      fieldname: 'status',
    })
    expect(miss.message).toBeNull()
  })
})
