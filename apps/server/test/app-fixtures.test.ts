// PLAT-006 (#78): an app manifest ships fixture documents — rows created
// through the normal saveDoc lifecycle at install time. The ledger records
// only what the install genuinely CREATED (adopt-don't-record, exactly like
// roles/grants), and uninstall removes exactly those rows: reverse order,
// before the app's tables drop, skipping rows the user already deleted.
// The helpdesk sample app is the flagship consumer — its full
// install → verify → uninstall round trip is pinned at the bottom.

import { describe, expect } from 'vitest'
import { test } from './pg-test'
import {
  registerApp,
  installApp,
  uninstallApp,
  isInstalled,
} from '../src/apps'
import { saveDoc, deleteDoc } from '../src/document'
import { sql } from '../src/db'
import type { AppManifest } from '../src/apps'

const APP = 'test-fixture-app'
const DT = 'Fixture Test Item'
const RULE = 'Fixture Test Notice'

function manifest(extra: Partial<AppManifest> = {}): AppManifest {
  return {
    name: APP,
    tables: [
      {
        name: DT,
        module: 'Test',
        id_pattern: 'prompt',
        columns: [{ column_name: 'title', column_type: 'Data' }],
      },
    ],
    fixtures: [
      // Rows on the app's OWN table…
      { table: DT, rows: [{ name: 'seed-1', title: 'first' }, { name: 'seed-2', title: 'second' }] },
      // …and a document on a CORE table that references the app's table —
      // uninstall must remove it BEFORE dropping the table it points at.
      {
        table: 'Email Rule',
        rows: [
          {
            name: RULE,
            ref_table: DT,
            event: 'on_save',
            recipient: 'ops@test.invalid',
            subject: 'fixture fired',
            enabled: false,
          },
        ],
      },
    ],
    ...extra,
  }
}

async function unwire() {
  await uninstallApp(APP).catch(() => {})
}

describe('PLAT-006: app fixtures install through the real lifecycle', () => {
  test('install materializes fixtures in order and records them; uninstall removes exactly them', async () => {
    registerApp(manifest())
    try {
      const res = await installApp(APP)
      expect(res.fixtures).toEqual([
        { table: DT, name: 'seed-1' },
        { table: DT, name: 'seed-2' },
        { table: 'Email Rule', name: RULE },
      ])

      // The rows exist — created through saveDoc, so standard columns are set.
      const [row] = await sql`select title, created_by from fixture_test_item where name = 'seed-1'`
      expect(row).toMatchObject({ title: 'first', created_by: 'Administrator' })
      const [rule] = await sql`select ref_table from email_rule where name = ${RULE}`
      expect(rule).toMatchObject({ ref_table: DT })

      // The ledger records the created fixture identities.
      const [ledger] = await sql`select fixtures from installed_app where name = ${APP}`
      expect(ledger.fixtures).toHaveLength(3)

      // Uninstall: fixture rows gone (incl. the Email Rule on the core
      // table), the app table dropped, the ledger row removed.
      await uninstallApp(APP)
      expect(await isInstalled(APP)).toBe(false)
      expect((await sql`select 1 from email_rule where name = ${RULE}`).length).toBe(0)
      expect((await sql`select 1 from table_def where name = ${DT}`).length).toBe(0)
    } finally {
      await unwire()
    }
  })

  test('a pre-existing look-alike row is adopted, never recorded — and survives uninstall', async () => {
    // The Email Rule exists BEFORE the install, with settings the manifest
    // disagrees with (a different recipient).
    await saveDoc('Email Rule', {
      name: RULE,
      ref_table: 'ToDo',
      event: 'on_save',
      recipient: 'pre-existing@test.invalid',
      enabled: false,
    })
    registerApp(manifest())
    try {
      const res = await installApp(APP)
      // Only the app's own two rows were created — the rule was adopted.
      expect(res.fixtures).toEqual([
        { table: DT, name: 'seed-1' },
        { table: DT, name: 'seed-2' },
      ])
      const [rule] = await sql`select ref_table, recipient from email_rule where name = ${RULE}`
      expect(rule).toMatchObject({ ref_table: 'ToDo', recipient: 'pre-existing@test.invalid' })

      await uninstallApp(APP)
      // The adopted row predates the app and must survive it.
      expect((await sql`select 1 from email_rule where name = ${RULE}`).length).toBe(1)
    } finally {
      await unwire()
      await deleteDoc('Email Rule', RULE).catch(() => {})
    }
  })

  test('a fixture row the user deleted after install is skipped quietly on uninstall', async () => {
    registerApp(manifest())
    try {
      await installApp(APP)
      await deleteDoc('Email Rule', RULE)
      await deleteDoc(DT, 'seed-2')
      // Uninstall neither throws nor resurrects — the remaining fixture row
      // and the table still come down.
      await uninstallApp(APP)
      expect(await isInstalled(APP)).toBe(false)
      expect((await sql`select 1 from table_def where name = ${DT}`).length).toBe(0)
    } finally {
      await unwire()
    }
  })

  test('a declarative manifest carries fixtures over the API — pure data, full round trip', async ({
    admin,
  }) => {
    const DECL = 'test-decl-fixture-app'
    try {
      const res = await admin.fetch('/api/install_app', {
        method: 'POST',
        body: JSON.stringify({
          manifest: {
            name: DECL,
            tables: [
              {
                name: 'Decl Fixture Item',
                module: 'Test',
                id_pattern: 'prompt',
                columns: [{ column_name: 'title', column_type: 'Data' }],
              },
            ],
            fixtures: [{ table: 'Decl Fixture Item', rows: [{ name: 'decl-1', title: 'shipped' }] }],
          },
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { fixtures: unknown }
      expect(body.fixtures).toEqual([{ table: 'Decl Fixture Item', name: 'decl-1' }])
      const [row] = await sql`select title from decl_fixture_item where name = 'decl-1'`
      expect(row).toMatchObject({ title: 'shipped' })

      const un = await admin.fetch('/api/uninstall_app', {
        method: 'POST',
        body: JSON.stringify({ name: DECL }),
      })
      expect(un.status).toBe(200)
      expect((await sql`select 1 from table_def where name = 'Decl Fixture Item'`).length).toBe(0)
    } finally {
      await uninstallApp(DECL).catch(() => {})
    }
  })

  test('a fixture that fails validation aborts the install and leaves no ledger row', async () => {
    registerApp(
      manifest({
        fixtures: [
          // recipient is reqd on Email Rule — this row cannot save.
          { table: 'Email Rule', rows: [{ name: RULE, ref_table: DT, event: 'on_save' }] },
        ],
      }),
    )
    try {
      await expect(installApp(APP)).rejects.toMatchObject({ type: 'ValidationError' })
      expect(await isInstalled(APP)).toBe(false)
    } finally {
      await unwire()
    }
  })

  test('an app table claiming system: true is refused — app tables are user-space', async () => {
    registerApp(
      manifest({
        tables: [
          {
            name: DT,
            module: 'Test',
            id_pattern: 'prompt',
            system: true,
            columns: [{ column_name: 'title', column_type: 'Data' }],
          },
        ],
        fixtures: [],
      }),
    )
    try {
      await expect(installApp(APP)).rejects.toMatchObject({
        type: 'ValidationError',
        message: expect.stringContaining('system'),
      })
      expect(await isInstalled(APP)).toBe(false)
      expect((await sql`select 1 from table_def where name = ${DT}`).length).toBe(0)
    } finally {
      await unwire()
    }
  })
})

describe('helpdesk: a registered app that installs and uninstalls cleanly', () => {
  test('full round trip: install brings up the whole structure, uninstall removes exactly it', async ({
    skip,
    createUser,
  }) => {
    // A dev database may carry committed helpdesk structure (seed:helpdesk /
    // the ticketing e2e); the round trip needs a clean slate, which CI and
    // throwaway DBs always are.
    const [dirty] = await sql`select 1 from table_def where name = 'HD Ticket'`
    if (dirty) skip('dev database already carries the helpdesk structure')

    // A look-alike fixture row that PREDATES the app: install must adopt it,
    // uninstall must leave it standing.
    await saveDoc('Email Account', {
      name: 'Helpdesk Notifications',
      email_id: 'pre-existing@corp.test',
    })

    const res = await installApp('helpdesk')
    try {
      expect(res.tables).toEqual(['HD Ticket'])
      expect(res.roles).toEqual(['Support Agent', 'Support Manager', 'Customer'])
      // 3 on HD Ticket + 2 ToDo + 3 Comment + 3 File + 2 Version.
      expect(res.perms).toHaveLength(13)
      // 6 fixture rows declared, 5 created — the Email Account was adopted.
      expect(res.fixtures.map((f) => f.table)).toEqual([
        'Workflow',
        'Email Rule',
        'Server Script',
        'Service Level Agreement',
        'Web Form',
      ])

      // Structure present: workflow with sub-rows, SLA with priorities, the
      // published web form, the automation rows.
      expect((await sql`select 1 from workflow where name = 'HD Ticket Flow'`).length).toBe(1)
      expect((await sql`select 1 from workflow_document_state where parent = 'HD Ticket Flow'`).length).toBe(4)
      expect((await sql`select 1 from workflow_transition where parent = 'HD Ticket Flow'`).length).toBe(4)
      expect((await sql`select 1 from sla_priority where parent = 'HD Ticket SLA'`).length).toBe(4)
      expect((await sql`select 1 from web_form where name = 'New Ticket' and published = true`).length).toBe(1)
      expect((await sql`select 1 from server_script where name = 'HD Ticket Defaults'`).length).toBe(1)
      expect((await sql`select 1 from email_rule where name = 'HD Ticket Resolved Notice'`).length).toBe(1)
      // The adopted account kept ITS email and never became app property.
      const [acct] = await sql`select email_id from email_account where name = 'Helpdesk Notifications'`
      expect(acct).toMatchObject({ email_id: 'pre-existing@corp.test' })

      // The app actually works end-to-end: a customer files through the
      // public web form and the SLA/server-script fixtures stamp the row.
      const customer = await createUser({ roles: ['Customer'] })
      const filed = await customer.post<{ name: string }>('/api/web_form/new-ticket', {
        values: { subject: 'Round-trip ticket', priority: 'Urgent' },
      })
      expect(filed.name).toMatch(/^HDT-\d{5}$/)
      const [ticket] = await sql`
        select raised_by, sla_status from hd_ticket where name = ${filed.name}`
      expect(ticket).toMatchObject({ raised_by: customer.user, sla_status: 'On Track' })
    } finally {
      await uninstallApp('helpdesk')
    }

    // Uninstall removed EXACTLY what install created — table, grants,
    // roles, workflow (and its sub-rows), SLA, scripts, web form — and the
    // ledger row. User tickets go with the table (it is the app's table).
    expect(await isInstalled('helpdesk')).toBe(false)
    expect((await sql`select 1 from table_def where name = 'HD Ticket'`).length).toBe(0)
    expect((await sql`select 1 from information_schema.tables where table_name = 'hd_ticket'`).length).toBe(0)
    expect((await sql`select 1 from workflow where name = 'HD Ticket Flow'`).length).toBe(0)
    expect((await sql`select 1 from workflow_document_state where parent = 'HD Ticket Flow'`).length).toBe(0)
    expect((await sql`select 1 from workflow_transition where parent = 'HD Ticket Flow'`).length).toBe(0)
    expect((await sql`select 1 from service_level_agreement where name = 'HD Ticket SLA'`).length).toBe(0)
    expect((await sql`select 1 from sla_priority where parent = 'HD Ticket SLA'`).length).toBe(0)
    expect((await sql`select 1 from server_script where name = 'HD Ticket Defaults'`).length).toBe(0)
    expect((await sql`select 1 from email_rule where name = 'HD Ticket Resolved Notice'`).length).toBe(0)
    expect((await sql`select 1 from web_form where name = 'New Ticket'`).length).toBe(0)
    expect((await sql`select 1 from permission where role in ('Support Agent', 'Support Manager', 'Customer')`).length).toBe(0)

    // The pre-existing look-alike Email Account survives (adopted, so never
    // in the ledger) — and it was never the app's default to dangle.
    const [acct] = await sql`select email_id from email_account where name = 'Helpdesk Notifications'`
    expect(acct).toMatchObject({ email_id: 'pre-existing@corp.test' })
  })

  test('helpdesk is registered but NOT installed: a fresh deployment has zero helpdesk tables', async ({
    admin,
  }) => {
    // Registration only puts the app in the available list — the ledger and
    // the schema stay empty until an explicit install. (On a dev database
    // that carries the committed structure the meta may exist; the ledger
    // check still holds — packaging never auto-installs.)
    expect(await isInstalled('helpdesk')).toBe(false)
    const apps = await admin.get<{ available: string[]; installed: { name: string }[] }>('/api/apps')
    expect(apps.available).toContain('helpdesk')
    expect(apps.installed.map((a) => a.name)).not.toContain('helpdesk')
  })
})
