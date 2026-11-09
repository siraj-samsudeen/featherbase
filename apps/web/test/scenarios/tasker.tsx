// Tasker as its spec scenarios meet it (#1070): Tasker installed, the
// scenario's named members (Meena, Ravi, …, and "the user", "a member", …),
// the stores, projects, tasks and issues a scenario starts from, the app's
// clock, and Tasker's page rendered in jsdom for whoever is looking at it.
// What a member does and sees goes through the page; setup goes through the
// server's own save, as the System Manager unless a step says who.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { sandboxRequest } from 'server/test/pg-test-shared'
import { issueSession } from 'server/src/auth'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { getDoc, saveDoc } from 'server/src/document'
import { enqueue, drainJobs } from 'server/src/jobs'
import { sql } from 'server/src/db'
import { TaskManagementPage } from '../../../../example-apps/tasker/src/TaskManagement'
import { localDay } from '../../../../example-apps/tasker/src/storeWork'
import { setSession } from '../../src/lib/api'
import { taskerClient } from '../../../server/test/tasker-client'
import { expect, screenSession } from '../pg-test'

export type Row = { row_id: string; updated_at: string; [field: string]: unknown }
type CreateUser = (options: { roles: string[]; fullName: string }) => Promise<TestClient>
export type User = ReturnType<typeof userEvent.setup>

// The full names of the people a scenario calls by role; named members
// (Meena, Ravi, …) are called by their own names.
const FULL_NAMES: Record<string, string> = { 'the user': 'Anitha', 'a member': 'Bala', 'another member': 'Chitra' }
const ADMIN = 'Administrator'

/** 'YYYY-MM-DD' for a day this many days from the given one. */
export function dayFrom(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

/** Puts the clock back to real time (each scenario file does so after every test). */
export function realTime() { vi.useRealTimers() }

export class TaskerWorld {
  /** Each named member's person id. */
  members = new Map<string, string>()
  /** Sessions by person id, each opened on the clock it was opened on. */
  private sessions = new Map<string, { clock: number | null; client: TestClient }>()
  private clock: number | null = null
  stores = new Map<string, Row>()
  projects = new Map<string, Row>()
  tasks = new Map<string, Row>()
  issues = new Map<string, Row>()
  /** The task the scenario is talking about ("it", "the task"). */
  current: Row | null = null
  /** The issue the scenario is talking about. */
  issue: Row | null = null
  /** Whoever last looked at Tasker, for steps that say what "the task shows". */
  viewer = 'the user'

  private constructor(private createUser: CreateUser) {}

  /** Tasker installed afresh, with the System Manager as a member, for this scenario. */
  static async start({ createUser, admin }: { createUser: CreateUser; admin: TestClient }) {
    expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
    if (await isInstalled('tasker')) await uninstallApp('tasker')
    await installApp('tasker')
    const person = await getDoc('Person', ADMIN, ADMIN)
    await saveDoc('Person', { ...person, roles: [...person.roles as Record<string, unknown>[], { role: 'Tasker Member' }] }, ADMIN)
    const world = new TaskerWorld(createUser)
    world.sessions.set(ADMIN, { clock: null, client: taskerClient(admin) })
    return world
  }

  /**
   * The app's clock: from now on the server and the page both read this
   * instant, which stands still until the scenario moves it.
   */
  setClock(instant: string | Date | number) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(instant))
    this.clock = new Date(instant).getTime()
  }

  /** A Tasker member with this name, created the first time the scenario names them; their person id. */
  async id(name: string) {
    let id = this.members.get(name)
    if (!id) {
      const client = taskerClient(await this.createUser({ roles: ['Tasker Member'], fullName: FULL_NAMES[name] ?? name }))
      id = client.user!
      this.members.set(name, id)
      this.sessions.set(id, { clock: this.clock, client })
    }
    return id
  }

  /**
   * The API as this member (or the System Manager), signed in afresh whenever
   * the clock has moved since: a session is valid only on the clock it was
   * opened on.
   */
  async member(name: string) { return this.session(await this.id(name)) }
  private async session(person: string) {
    const known = this.sessions.get(person)
    if (known && known.clock === this.clock) return known.client
    const { token } = await issueSession(person)
    const client = taskerClient(makeClient({ request: sandboxRequest }, token, person))
    this.sessions.set(person, { clock: this.clock, client })
    return client
  }

  // --- the app's day ----------------------------------------------------------

  /** Today on the app's clock, 'YYYY-MM-DD' (the page's day, which marks tasks). */
  today() { return localDay(new Date()) }
  daysFromToday(offset: number) { return dayFrom(this.today(), offset) }

  // --- rows -------------------------------------------------------------------

  /** Saves a row (new, or changes to one read fresh) through the server's own save, as this person. */
  async save(table: string, row: Record<string, unknown>, by = ADMIN): Promise<Row> {
    if (row.row_id) {
      const current = await getDoc(table, String(row.row_id), ADMIN)
      await saveDoc(table, { ...row, updated_at: current.updated_at }, by)
      return this.read(table, String(row.row_id), by)
    }
    const made = await saveDoc(table, row, by) as Row
    return this.read(table, made.row_id, by)
  }
  /** A row as the System Manager (or this person) reads it over HTTP. */
  async read(table: string, id: string, by = ADMIN) { return (await this.session(by)).get<Row>(`/api/table/${table}/${encodeURIComponent(id)}`) }

  /** The same change sent over HTTP as this member, answered: { ok, message } instead of throwing. */
  async attempt(table: string, row: Record<string, unknown> & { row_id: string }, as: string) {
    const current = await this.read(table, row.row_id)
    const res = await (await this.member(as)).fetch('/api/save_row', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, row: { ...row, updated_at: current.updated_at } }),
    })
    const text = await res.text()
    let message = text
    try { const body = JSON.parse(text); message = body.error?.message ?? body.message ?? text } catch { /* plain text */ }
    return { ok: res.ok, status: res.status, message: String(message) }
  }

  async store(name: string, values: Record<string, unknown> = {}) {
    const known = this.stores.get(name)
    if (!known) this.stores.set(name, await this.save('tasker.store', { store_name: name, store_type: 'Store', ...values }))
    else if (Object.keys(values).length) this.stores.set(name, await this.save('tasker.store', { row_id: known.row_id, ...values }))
    return this.stores.get(name)!
  }

  /** Every store with this name, as stored. */
  storesNamed(name: string) { return rowsWhere('tasker.store', 'store_name', name) }

  /** A shared project; tasks the scenario does not place elsewhere go in "Store operations". */
  async project(name = 'Store operations', values: Record<string, unknown> = {}) {
    const known = this.projects.get(name)
    if (!known) this.projects.set(name, await this.save('tasker.project', { project_name: name, ...values }))
    else if (Object.keys(values).length) this.projects.set(name, await this.save('tasker.project', { row_id: known.row_id, ...values }))
    return this.projects.get(name)!
  }

  /** A task in a shared project, created by the System Manager unless `by` says who (a member's id). */
  async task(title: string, values: Record<string, unknown> = {}, by = ADMIN) {
    const project = values.project === undefined ? (await this.project()).row_id : values.project
    const row = await this.save('tasker.task', { task_title: title, ...values, project }, by)
    this.tasks.set(title, row)
    this.current = row
    return row
  }

  /** Changes to a task the scenario already has. */
  async change(title: string, values: Record<string, unknown>, by = ADMIN) {
    const row = await this.save('tasker.task', { row_id: this.tasks.get(title)!.row_id, ...values }, by)
    this.tasks.set(title, row)
    this.current = row
    return row
  }

  /** A task the scenario did not make itself (one a member added on the page), by its title. */
  async findTask(title: string) {
    const [found] = await rowsWhere('tasker.task', 'task_title', title)
    if (!found) throw new Error(`no task "${title}" was saved`)
    const row = await this.read('tasker.task', found)
    this.tasks.set(title, row)
    this.current = row
    return row
  }

  async findIssue(title: string) {
    const [found] = await rowsWhere('tasker.issue', 'issue_title', title)
    if (!found) throw new Error(`no issue "${title}" was saved`)
    const row = await this.read('tasker.issue', found)
    this.issues.set(title, row)
    this.issue = row
    return row
  }

  /** The name of the project a task is in. */
  projectOf(task = this.current!) {
    const project = [...this.projects.values()].find(p => p.row_id === task.project)
    if (!project) throw new Error(`task "${String(task.task_title)}" is in no project of this scenario`)
    return String(project.project_name)
  }

  /** The task's row as stored now. */
  fresh(task = this.current!) { return this.read('tasker.task', task.row_id) }
  issueRow(issue = this.issue!) { return this.read('tasker.issue', issue.row_id) }

  /** An issue raised through the server (by the System Manager unless `by` says who). */
  async raise(title: string, values: Record<string, unknown> = {}, by = ADMIN) {
    const row = await this.save('tasker.issue', {
      issue_title: title, category: 'Equipment failure', severity: 'High', owner_function: 'Facilities', ...values,
    }, by)
    this.issues.set(title, row)
    this.issue = row
    return row
  }

  slaRule(severity: string, values: Record<string, unknown>) { return this.save('tasker.sla_rule', { severity, ...values }) }
  functionHead(ownerFunction: string, head: string) { return this.save('tasker.function_head', { owner_function: ownerFunction, head }) }

  /** One run of Tasker's escalation job, on the app's clock, waited for. */
  async escalationRun() {
    // The scheduled run is taken off the queue: on a clock set in the past,
    // each of its runs would queue the next one already due, for ever.
    await sql`delete from background_job where method = 'tasker.escalate_issues' and job_status = 'queued'`
    const job = await enqueue('tasker.escalate_issues', {})
    await sql`update background_job set run_at = now() - interval '1 second' where row_id = ${job}`
    await drainJobs()
    const [run] = await sql`select job_status, error from background_job where row_id = ${job}` as { job_status: string; error: string | null }[]
    if (run?.job_status !== 'done') throw new Error(`the escalation job did not finish: ${run?.job_status} ${run?.error ?? ''}`)
  }

  /** Tasker's page as this member, opened fresh: whatever was on screen is gone. */
  async as(who: string) {
    const member = await this.member(who)
    cleanup()
    location.hash = ''
    setSession(member.token!, { row_id: member.user!, email: member.user!, full_name: null })
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskManagementPage /></QueryClientProvider>)
    this.viewer = who
    return new TaskerPage(userEvent.setup())
  }

  /** Tasker as whoever last looked at it in this scenario, or the user. */
  viewerPage() { return this.as(this.viewer) }
}

/** The row ids of a Tasker Table's rows whose column has this value. */
async function rowsWhere(table: string, column: string, value: string) {
  const rows = await sql.unsafe(`select row_id from ${await relationOf(table)} where ${column} = $1`, [value]) as { row_id: string }[]
  return rows.map(r => r.row_id)
}

async function relationOf(table: string) {
  const [def] = await sql`select physical_schema, physical_relation from featherbase.table_def where name = ${table}` as { physical_schema: string; physical_relation: string }[]
  if (!def) throw new Error(`no Table ${table}`)
  return `"${def.physical_schema}"."${def.physical_relation}"`
}

/** Tasker's page for one member, rendered: its sidebar views, a project's tasks, task details, Stores, To verify and Issues. */
export class TaskerPage {
  /** Drives the page with the Session DSL. Most of Tasker's selects carry their name in
   *  aria-label, or in a <label> that also holds the options' text: the DSL's label lookup
   *  can't name those, so they are chosen through `user`. */
  readonly session = screenSession()
  constructor(readonly user: User) {}

  // --- getting around ---------------------------------------------------------

  async sidebarView(name: RegExp) {
    await this.user.click(await screen.findByRole('button', { name }))
  }

  async openProject(name: string) {
    await this.session.clickButton(name)
    await screen.findByRole('heading', { name })
  }

  /** A task's details, opened by its address. */
  async openTask(id: string, title: string) {
    location.hash = `task=${encodeURIComponent(id)}`
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    const detail = await screen.findByRole('region', { name: 'Task detail content' })
    await within(detail).findByRole('heading', { name: title })
    await within(detail).findByRole('combobox', { name: 'Task state' })
    return detail
  }

  detail() { return screen.getByRole('region', { name: 'Task detail content' }) }

  // --- task lists -------------------------------------------------------------

  /** A task's row in the list on screen. */
  async row(title: string) {
    const main = document.querySelector('main.tasker-main') as HTMLElement
    const link = await within(main).findByRole('link', { name: title })
    return link.closest('.tasker-task-row') as HTMLElement
  }

  /** What a task's row says beside its title: store, due mark and closure notes (not its menus). */
  async rowCopy(title: string) { return (await this.row(title)).querySelector('.tasker-task-copy') as HTMLElement }

  async expectRowShows(title: string, text: string) {
    await waitFor(async () => expect(await this.rowCopy(title)).toHaveTextContent(text), { timeout: 8000 })
  }

  async expectRowLacks(title: string, text: string) {
    await waitFor(async () => expect(await this.rowCopy(title)).not.toHaveTextContent(text), { timeout: 8000 })
  }

  /** The row's due mark: { mark, text } or null. */
  async dueMark(title: string) {
    const chip = (await this.rowCopy(title)).querySelector('.tasker-due-chip')
    return chip ? { mark: chip.getAttribute('data-mark'), text: chip.textContent!.trim() } : null
  }

  async expectDueMark(title: string, mark: string) {
    await waitFor(async () => expect((await this.dueMark(title))?.mark).toBe(mark), { timeout: 8000 })
  }

  doneBox(title: string) { return screen.getByRole('checkbox', { name: `Mark ${title} done` }) as HTMLInputElement }

  /** The titles of the tasks in the list on screen. */
  listedTitles() {
    return [...document.querySelectorAll('main.tasker-main .tasker-task-row .tasker-task-copy > a')].map(a => a.textContent!.trim())
  }

  async expectListed(title: string) { await waitFor(() => expect(this.listedTitles()).toContain(title)) }
  async expectNotListed(title: string) { await waitFor(() => expect(this.listedTitles()).not.toContain(title)) }

  /** Narrows the list on screen with the Filter menu: a group ('Due', 'Store') and a choice in it. */
  async narrow(group: string, choice: string) {
    const main = document.querySelector('main.tasker-main') as HTMLElement
    await this.user.click(within(main).getByRole('button', { name: /^Filter/ }))
    const filters = await screen.findByRole('dialog', { name: 'Filter tasks' })
    await this.user.click(await within(within(filters).getByRole('group', { name: group })).findByRole('checkbox', { name: choice }))
    await this.session.within('[aria-label="Filter tasks"]', (dialog) => dialog.clickButton('Close'))
    await within(main).findByRole('button', { name: `Remove ${choice} filter` })
  }

  rowState(title: string) { return (screen.getByRole('combobox', { name: `State for ${title}` }) as HTMLSelectElement).value }
}

/** Waits until `read` returns a value that passes `check`. */
export async function eventually<T>(read: () => Promise<T>, check: (value: T) => void) {
  await waitFor(async () => check(await read()), { timeout: 8000 })
}
