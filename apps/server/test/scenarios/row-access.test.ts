// row-access (#1459): every table says who reads which of its rows; with no rule only System Managers read it.
// One example runs through every scenario: Asha and Bram, who may read and change "Projects" and "Tasks".
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { afterEach, describe, expect } from 'vitest'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { expectRefused, grantRole, makeTable, tableRef } from '../fixtures'
import { discoverPackages } from '../../src/runtime-packages'

const scenario = scenarioFor(test, 'row-access')
const PROJECTS = tableRef('Projects')
const TASKS = tableRef('Tasks')
const ROLE = 'Project Worker'
const HERS = 'asha-project'
const HIS = 'bram-project'

type Rule = Record<string, unknown> | null
const setRule = (admin: TestClient, table: ReturnType<typeof tableRef>, row_rule: Rule) => admin.put(`${table.defUrl}/row_rule`, { row_rule })
const listed = async (client: TestClient, table = PROJECTS) =>
  (await client.get<{ data: { row_id: string }[] }>(table.listUrl({ limit_page_length: 500 }))).data.map((row) => row.row_id).sort()

/** "Projects" and "Tasks", which the role may read and change, and Asha and Bram holding it. */
async function people(admin: TestClient, createUser: CreateUserFn) {
  await makeTable(admin, { name: PROJECTS.name, id_pattern: 'prompt', row_rule: null,
    columns: ['title', { column_name: 'owner', column_type: 'Reference', reference_table: 'Person' }] })
  await makeTable(admin, { name: TASKS.name, id_pattern: 'prompt', row_rule: null,
    columns: ['title', { column_name: 'project', column_type: 'Reference', reference_table: PROJECTS.name }] })
  await grantRole(admin, { role: ROLE, table: [PROJECTS.name, TASKS.name], can_read: true, can_write: true, can_create: true })
  return { asha: await createUser({ roles: [ROLE] }), bram: await createUser({ roles: [ROLE] }) }
}
/** A project each of them made: rows are written while the table reads whole, then `rule` is set. */
async function projects(admin: TestClient, asha: TestClient, bram: TestClient | null, rule: Rule) {
  await setRule(admin, PROJECTS, { kind: 'all' })
  await asha.post(PROJECTS.url, { row_id: HERS, title: 'North fit-out' })
  if (bram) await bram.post(PROJECTS.url, { row_id: HIS, title: 'South fit-out' })
  await setRule(admin, PROJECTS, rule)
}

describe('row-access', () => {
  scenario('A new table shows nothing until its rule is set', async ({ admin, createUser }, step) => {
    let asha!: TestClient
    let rows: string[] = []
    await step('a table "Projects" with no row rule, holding a project Asha made', async () => {
      ;({ asha } = await people(admin, createUser))
      await projects(admin, asha, null, null)
    })
    await step('Asha may read and change "Projects"')
    await step('Asha opens the list of "Projects"', async () => { rows = await listed(asha) })
    await step('the list is empty', () => expect(rows).toEqual([]))
    await step('opening or changing her project is refused', async () => {
      await expectRefused(asha.get(PROJECTS.rowUrl(HERS)), 403, 'has no row rule yet')
      const row = await admin.get<{ updated_at: string }>(PROJECTS.rowUrl(HERS))
      await expectRefused(await asha.fetch(PROJECTS.rowUrl(HERS), { method: 'PATCH', body: JSON.stringify({ updated_at: row.updated_at, title: 'Mine' }) }), 403)
    })
    await step('a System Manager sees the project', async () => expect(await listed(admin)).toEqual([HERS]))
  })

  scenario('Every project, for those granted', async ({ admin, createUser }, step) => {
    let asha!: TestClient
    let rows: string[] = []
    await step('"Projects" gives every row to those granted it, and holds a project Asha made and one Bram made', async () => {
      const made = await people(admin, createUser)
      asha = made.asha
      await projects(admin, asha, made.bram, { kind: 'all' })
    })
    await step('Asha may read and change "Projects"')
    await step('Asha opens the list of "Projects"', async () => { rows = await listed(asha) })
    await step('she sees both projects', () => expect(rows).toEqual([HERS, HIS]))
  })

  scenario('Only the projects a person made', async ({ admin, createUser }, step) => {
    let asha!: TestClient
    let rows: string[] = []
    await step('"Projects" gives each person their own rows, and holds a project Asha made and one Bram made', async () => {
      const made = await people(admin, createUser)
      asha = made.asha
      await projects(admin, asha, made.bram, { kind: 'own' })
    })
    await step('Asha may read and change "Projects"')
    await step('Asha opens the list of "Projects"', async () => { rows = await listed(asha) })
    await step('she sees only her project', () => expect(rows).toEqual([HERS]))
    await step('she is shown a count of 1 project', async () =>
      expect((await asha.post<{ count: number }>('/api/dashboard/count', { table: PROJECTS.name })).count).toBe(1))
    await step('opening Bram\'s project is refused', () => expectRefused(asha.get(PROJECTS.rowUrl(HIS)), 403, 'not one of your rows'))
  })

  scenario('A project that names the person is theirs too', async ({ admin, createUser }, step) => {
    let asha!: TestClient
    let rows: string[] = []
    await step('"Projects" gives each person their own rows and the rows naming them as owner', async () => {
      ;({ asha } = await people(admin, createUser))
      await setRule(admin, PROJECTS, { kind: 'own', columns: ['owner'] })
    })
    await step('a System Manager made a project naming Asha as owner', () => admin.post(PROJECTS.url, { row_id: 'depot', title: 'Depot fit-out', owner: asha.user }))
    await step('Asha opens the list of "Projects"', async () => { rows = await listed(asha) })
    await step('she sees that project', () => expect(rows).toEqual(['depot']))
  })

  scenario('A task is read with its project', async ({ admin, createUser }, step) => {
    let asha!: TestClient
    let rows: string[] = []
    await step('"Projects" gives each person their own rows, and holds a project Asha made and one Bram made', async () => {
      const made = await people(admin, createUser)
      asha = made.asha
      await projects(admin, asha, made.bram, { kind: 'own' })
    })
    await step('"Tasks" follows its project, with a task on each project and one on no project', async () => {
      for (const [row_id, project] of [['on-hers', HERS], ['on-his', HIS], ['loose', undefined]])
        await admin.post(TASKS.url, { row_id, title: `Task ${row_id}`, project })
      await setRule(admin, TASKS, { kind: 'through', column: 'project' })
    })
    await step('Asha opens the list of "Tasks"', async () => { rows = await listed(asha, TASKS) })
    await step('she sees only the task on her project', () => expect(rows).toEqual(['on-hers']))
    await step('adding a task to Bram\'s project is refused', () => expectRefused(asha.post(TASKS.url, { row_id: 'sneaked', title: 'Sneaked', project: HIS }), 403))
  })

  scenario('A table only System Managers read', async ({ admin, createUser }, step) => {
    let asha!: TestClient
    let rows: string[] = ['unread']
    await step('"Projects" is kept to System Managers, and holds a project Asha made', async () => {
      ;({ asha } = await people(admin, createUser))
      await projects(admin, asha, null, { kind: 'administrators' })
    })
    await step('Asha may read and change "Projects"')
    await step('Asha opens the list of "Projects"', async () => { rows = await listed(asha) })
    await step('the list is empty', () => expect(rows).toEqual([]))
  })

  scenario('Head office reads every project', async ({ admin, createUser }, step) => {
    let made!: Awaited<ReturnType<typeof people>>
    let rows: string[] = []
    await step('"Projects" gives each person their own rows, but every row to the role "Head Office"', async () => {
      made = await people(admin, createUser)
      await grantRole(admin, { role: 'Head Office', table: [] })
    })
    await step('"Projects" holds a project Asha made and one Bram made', () => projects(admin, made.asha, made.bram, { kind: 'own', whole_for: ['Head Office'] }))
    await step('someone granted "Projects" who also holds "Head Office" opens the list', async () => {
      rows = await listed(await createUser({ roles: [ROLE, 'Head Office'] }))
    })
    await step('they see both projects', () => expect(rows).toEqual([HERS, HIS]))
    await step('someone holding "Head Office" alone is refused', async () => expectRefused((await createUser({ roles: ['Head Office'] })).get(PROJECTS.url), 403))
  })

  // An app that brings two tables, written to a folder the platform discovers.
  const APP = 'rowaccess'
  const NOTE = tableRef(`${APP}.note`)
  const LOG = tableRef(`${APP}.log`)
  const folders: string[] = []
  afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })
  async function installApp(admin: TestClient, rowRules: Record<string, unknown>) {
    const dir = await mkdtemp(resolve('test/.row-access-'))
    folders.push(dir)
    const body = [{ column_name: 'body', column_type: 'Data' }]
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `featherbase-${APP}`, version: '1.0.0', type: 'module' }))
    await writeFile(join(dir, 'featherbase.json'), JSON.stringify({
      manifestVersion: 1, platformVersion: '2026-10', name: APP, title: 'Row access proof', entryTable: NOTE.name,
      tables: [{ name: NOTE.name, label: 'note', id_pattern: 'prompt', columns: body }, { name: LOG.name, label: 'log', id_pattern: 'prompt', columns: body }],
      roles: ['Log Reader'],
      permissions: [{ table: NOTE.name, role: 'Log Reader', can_read: true }, { table: LOG.name, role: 'Log Reader', can_read: true }],
      rowRules,
    }))
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    await admin.post('/api/save_row', { table: LOG.name, row: { row_id: 'line-1', body: 'a line' } })
  }

  scenario('A table the app says nothing about is closed', async ({ admin, createUser }, step) => {
    let user!: TestClient
    let rows: string[] = ['unread']
    await step('an app brings the tables "note", with each person\'s own rows, and "log", with no rule', () => installApp(admin, { [NOTE.name]: { kind: 'own' } }))
    await step('the user may read both', async () => { user = await createUser({ roles: ['Log Reader'] }) })
    await step('the user opens the list of "log"', async () => { rows = await listed(user, LOG) })
    await step('the list is empty', () => expect(rows).toEqual([]))
  })

  scenario('The instance\'s rule replaces the app\'s', async ({ admin, createUser }, step) => {
    let user!: TestClient
    await step('an app brings the table "log" with every row for those granted, holding one line', () => installApp(admin, { [NOTE.name]: { kind: 'own' }, [LOG.name]: { kind: 'all' } }))
    await step('the user may read "log"', async () => {
      user = await createUser({ roles: ['Log Reader'] })
      expect(await listed(user, LOG)).toEqual(['line-1'])
    })
    await step('a System Manager keeps "log" to System Managers', () => setRule(admin, LOG, { kind: 'administrators' }))
    await step('the user\'s list of "log" is empty', async () => expect(await listed(user, LOG)).toEqual([]))
    await step('it shows the line again once the System Manager takes that rule away', async () => {
      await setRule(admin, LOG, null)
      expect(await listed(user, LOG)).toEqual(['line-1'])
    })
  })

  scenario('Tables with no rule, and tables everyone reads', async ({ admin }, step) => {
    let lines: { table: string; rule: unknown; everyone_reads_whole: boolean }[] = []
    await step('a table "Drafts" with no row rule', () => makeTable(admin, { name: 'Drafts', columns: ['title'], row_rule: null }))
    await step('a table "Notices" that gives every row to those granted it, granted to everyone who signs in', async () => {
      await makeTable(admin, { name: 'Notices', columns: ['title'], row_rule: { kind: 'all' } })
      await grantRole(admin, { role: 'All', table: 'Notices', can_read: true })
    })
    await step('a System Manager reviews the tables\' rules', async () => { lines = (await admin.get<{ data: typeof lines }>('/api/row_rules')).data })
    await step('"Drafts" is listed as having none', () => expect(lines.find((l) => l.table === 'Drafts')).toMatchObject({ rule: null, everyone_reads_whole: false }))
    await step('"Notices" is listed as read whole by everyone who signs in', () =>
      expect(lines.find((l) => l.table === 'Notices')).toMatchObject({ rule: { kind: 'all' }, everyone_reads_whole: true }))
  })
})
