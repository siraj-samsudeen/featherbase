// running-an-instance's scenarios (#1070): the `featherbase` command a person
// runs from the checkout. Each test is one fenced scenario of
// openspec/specs/running-an-instance/spec.md, step by step.
//
// The command is the public boundary, so it runs as its own process
// (tools/featherbase.mjs), against a disposable database of its own; `start
// --check` starts the real API and web app on free ports, signs in and stops
// them. Reset runs on the disposable instances of tools/reset-fixture.mjs.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, test } from 'vitest'
import { verifyPassword } from '../../src/auth'
import { config } from '../../src/config'
import { resetFixture, type ResetFixture } from '../../../../tools/reset-fixture.mjs'
import { scenarioFor } from '../scenario'

const scenario = scenarioFor(test, 'running-an-instance')
const ROOT = resolve(__dirname, '../../../..')
const TASKER = join(ROOT, 'example-apps/tasker')
const SECRET = 'running-an-instance-private-secret'
type Result = { status: number | null; stdout: string; stderr: string }
type Sql = ReturnType<typeof postgres>

/** Run the command as a person does, from the checkout, and collect what it says. */
function featherbase(args: string[], env: NodeJS.ProcessEnv, input = ''): Promise<Result> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['tools/featherbase.mjs', ...args], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', fail)
    child.once('close', (status) => done({ status, stdout, stderr }))
    child.stdin.end(input)
  })
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => done(port))
    })
  })
}

// ---- A disposable local instance: its own database and uploads ----

const admin = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})
afterAll(() => admin.end({ timeout: 5 }))

interface Instance { env: NodeJS.ProcessEnv; sql: Sql; name: string }

async function localInstance(environment: 'development' | 'test' = 'development'): Promise<Instance> {
  const name = `featherbase_running_${randomUUID().replaceAll('-', '')}`
  const url = new URL(config.databaseUrl)
  url.pathname = `/${name}`
  const uploads = mkdtempSync(join(tmpdir(), 'featherbase-running-uploads-'))
  const [api, web] = [await freePort(), await freePort()]
  const env: NodeJS.ProcessEnv = {
    ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'development', FEATHERBASE_ENV: environment,
    FEATHERBASE_INSTANCE: '', FEATHERBASE_APP_PATHS: '[]', FILE_STORAGE_DIR: uploads, MOTHERDUCK_TOKEN: '',
    API_PORT: String(api), WEB_PORT: String(web), PORT: String(api),
    SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '', GOOGLE_CLIENT_SECRET: SECRET,
  }
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} })
  cleanups.push(async () => {
    await sql.end({ timeout: 5 })
    await admin.unsafe(`drop database if exists "${name}" with (force)`)
    rmSync(uploads, { recursive: true, force: true })
  })
  return { env, sql, name }
}

/** `featherbase setup` on the instance: the platform's database, prepared. */
async function prepare(instance: Instance) {
  const result = await featherbase(['setup'], { ...instance.env, FEATHERBASE_ENV: 'development' })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  return result
}

/** Tasker installed by explicit name, with a task of the person's own in it. */
async function seedTask(instance: Instance) {
  const installed = await featherbase(['advanced', 'apps', 'install-app', 'tasker'],
    { ...instance.env, FEATHERBASE_APP_PATHS: JSON.stringify([TASKER]) })
  expect(installed.status, installed.stdout + installed.stderr).toBe(0)
  const tasks = await taskStore(instance)
  const [task] = await instance.sql`insert into ${instance.sql(tasks)} (row_id, task_title, created_by, updated_by)
    values (${`TASK-${randomUUID().slice(0, 8)}`}, 'Preserve this acceptance task', 'Administrator', 'Administrator') returning row_id`
  return String(task!.row_id)
}

/** Where Tasker keeps its tasks: the app's own storage, found by its column. */
async function taskStore(instance: Instance) {
  const [store] = await instance.sql`select table_schema, table_name from information_schema.columns
    where column_name = 'task_title' and table_schema <> 'information_schema'`
  expect(store, "Tasker's task storage").toBeDefined()
  return `${store!.table_schema}.${store!.table_name}`
}

async function preserved(instance: Instance, task: string) {
  const [tasker] = await instance.sql`select enabled from featherbase.installed_app where name = 'tasker'`
  expect(tasker, 'Tasker is still installed').toMatchObject({ enabled: true })
  const [row] = await instance.sql`select task_title from ${instance.sql(await taskStore(instance))} where row_id = ${task}`
  expect(row?.task_title).toBe('Preserve this acceptance task')
}

async function noInstalledApps(instance: Instance) {
  expect(await instance.sql`select name from featherbase.installed_app`).toHaveLength(0)
  // Nor any app's storage: no Tasker task table under any name.
  expect(await instance.sql`select table_name from information_schema.columns where column_name = 'task_title'`).toHaveLength(0)
  expect(await instance.sql`select table_name from information_schema.tables where table_schema = 'featherbase'
    and (table_name like 'tasker.%' or table_name like 'dash.%')`).toHaveLength(0)
}

/** Every built file of the client and test apps: path, time and size. */
function artifactSnapshot() {
  const entries: [string, number, number][] = []
  const visit = (directory: string) => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      if (entry.isDirectory()) visit(file)
      else if (file.includes('/dist/')) entries.push([file, statSync(file).mtimeMs, statSync(file).size])
    }
  }
  visit(join(ROOT, 'client-apps'))
  visit(join(ROOT, 'test-apps'))
  return entries
}

async function start(instance: Instance) {
  const result = await featherbase(['start', '--check'], instance.env)
  expect(result.status, result.stderr + result.stdout).toBe(0)
  return result
}

/** The scheduled health job's last run failed. */
async function failedJob(instance: Instance) {
  const rows = await instance.sql`update featherbase.scheduled_job set enabled = true, last_run_at = now(), last_outcome = 'error',
    last_result = 'Acceptance operational failure' where method = 'check_instance_health' returning method`
  expect(rows, 'the platform health job must exist').toHaveLength(1)
}

type Report = { failing: number; setup_needed: number; checks: { key: string; state: string; fix: string | null }[] }
function check(report: Report, key: string) {
  const found = report.checks.find((c) => c.key === key)
  expect(found, `health report must include ${key}`).toBeDefined()
  return found!
}

// ---- Reset: two disposable local instances (tools/reset-fixture.mjs) ----

async function twoResetInstances(): Promise<ResetFixture> {
  const fixture = await resetFixture()
  cleanups.push(() => fixture.close())
  return fixture
}

describe('running-an-instance', () => {
  // ---- Start with only the platform ----

  scenario('A fresh checkout opens only Featherbase', async (_, step) => {
    let instance!: Instance
    let before: ReturnType<typeof artifactSnapshot> = []
    let started!: Result
    await step('the user has a fresh checkout and an empty development instance', async () => {
      instance = await localInstance()
    })
    await step('the user starts Featherbase without choosing an instance or any apps', async () => {
      before = artifactSnapshot()
      started = await start(instance)
    })
    await step('the user can sign in to Featherbase', async () => {
      // --check signs in as Administrator against the started API before it stops.
      expect(started.stdout).toContain('check passed')
      const [administrator] = await instance.sql`select password_hash from featherbase.person where row_id = 'Administrator'`
      expect(verifyPassword('admin', String(administrator!.password_hash))).toBe(true)
    })
    await step('no example app, client app or test app is installed', () => noInstalledApps(instance))
    await step('no client app or test app was built by the startup command', () => expect(artifactSnapshot()).toEqual(before))
  }, 240_000)

  scenario('Starting again keeps a chosen app', async (_, step) => {
    let instance!: Instance
    let task = ''
    await step('the user has explicitly installed Tasker on a development instance', async () => {
      instance = await localInstance()
      await prepare(instance)
      task = await seedTask(instance)
    })
    await step('the user starts Featherbase again without choosing an instance or any apps', () => start(instance))
    await step('Tasker and its existing tasks are still installed', () => preserved(instance, task))
  }, 240_000)

  // ---- Discover the command line without prior knowledge ----

  scenario('The user has not chosen a command', async (_, step) => {
    let env!: NodeJS.ProcessEnv
    let result!: Result
    await step('the user has installed the checkout dependencies but has not configured a database', () => {
      env = { ...process.env, DATABASE_URL: 'not-a-database-url' }
    })
    await step('the user opens Featherbase command-line help', async () => { result = await featherbase([], env) })
    await step('the user sees how to prepare an instance, start it and check its health', () => {
      for (const action of ['setup', 'start', 'health']) expect(result.stdout).toContain(`featherbase ${action}`)
    })
    await step('each action explains what it does and what to run next', () => {
      for (const text of ['Prepare the platform database', 'Start the API and web app', 'Report readiness', 'Next:'])
        expect(result.stdout).toContain(text)
    })
    await step('help does not require a database connection', () => expect(result.status, result.stderr).toBe(0))
  })

  scenario('A command is mistyped', async (_, step) => {
    let env!: NodeJS.ProcessEnv
    let result!: Result
    await step('the user has installed the checkout dependencies', () => {
      env = { ...process.env, DATABASE_URL: 'not-a-database-url' }
    })
    await step('the user enters an unknown Featherbase command', async () => { result = await featherbase(['setpu'], env) })
    await step('the command fails and points to the relevant help', () => {
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Run featherbase --help')
    })
    await step('no setup or installation is performed', () => expect(result.stdout).toBe(''))
  })

  // ---- Prepare a local instance deliberately ----

  scenario('Setup is safe to repeat', async (_, step) => {
    let instance!: Instance
    let task = ''
    let again!: Result
    await step('the user has prepared a local Featherbase instance', async () => {
      instance = await localInstance()
      await prepare(instance)
      task = await seedTask(instance)
    })
    await step('the user runs the preparation command again', async () => { again = await prepare(instance) })
    await step('existing data and installed apps are preserved', () => preserved(instance, task))
    await step('the user is told what changed and how to start the instance', () => {
      expect(again.stdout).toMatch(/schema is up to date/)
      expect(again.stdout).toMatch(/Next: featherbase start/)
    })
  }, 120_000)

  // ---- Read a useful health report from the command line ----

  scenario('A clean local instance needs no optional services', async (_, step) => {
    let instance!: Instance
    let result!: Result
    await step('the user has a new local instance using built-in defaults', async () => {
      instance = await localInstance()
      await prepare(instance)
    })
    await step('the user checks its health from the command line', async () => { result = await featherbase(['health'], instance.env) })
    await step('the report succeeds and says it is ready to explore', () => {
      expect(result.status, result.stderr + result.stdout).toBe(0)
      expect(result.stdout).toMatch(/ready to explore/)
    })
    await step('optional configuration is reported separately from faults', () => {
      expect(result.stdout).toMatch(/optional: Settings file applied/)
      expect(result.stdout).not.toMatch(/^fault:/m)
    })
  }, 120_000)

  scenario('A real failure is actionable for a person or an agent', async (_, step) => {
    let instance!: Instance
    let result!: Result
    let report!: Report
    await step('the user has a local instance with an enabled scheduled job whose last run failed', async () => {
      instance = await localInstance()
      await prepare(instance)
      await failedJob(instance)
    })
    await step('the user requests a machine-readable command-line health report', async () => {
      result = await featherbase(['health', '--json'], instance.env)
      report = JSON.parse(result.stdout.trim())
    })
    await step('the command fails and the report identifies the failed check and next action', () => {
      expect(result.status).toBe(1)
      const failed = check(report, 'scheduled-job:check_instance_health')
      expect(failed.state).toBe('fault')
      expect(failed.fix).toBeTruthy()
    })
    await step('the report does not contain secret values', () => {
      expect(result.stdout).not.toContain(SECRET)
      expect(result.stdout).not.toContain(instance.env.DATABASE_URL)
    })
  }, 120_000)

  scenario('Required hosted setup is not ready', async (_, step) => {
    let instance!: Instance
    let result!: Result
    let report!: Report
    await step('the user has a hosted instance missing required notice recipients', async () => {
      instance = await localInstance('test')
      await prepare(instance)
      await instance.sql`update featherbase.internal_metadata set value = 'test' where key = 'environment'`
    })
    await step('the user requests a machine-readable command-line health report', async () => {
      result = await featherbase(['health', '--json'], instance.env)
      report = JSON.parse(result.stdout.trim())
    })
    await step('the command fails with a setup-readiness finding and the next action', () => {
      expect(result.status).toBe(1)
      const email = check(report, 'system-manager-email')
      expect(email.state).toBe('setup-needed')
      expect(email.fix).toBeTruthy()
    })
    await step('the missing setup is distinguished from an operational fault', () => {
      expect(report.failing, JSON.stringify(report.checks.filter((c) => c.state === 'fault'))).toBe(0)
      expect(report.setup_needed).toBeGreaterThan(0)
    })
  }, 120_000)

  // ---- Local instances keep separate uploads; reset needs a deliberate local selection ----

  scenario('Two local instances have different uploads', async (_, step) => {
    let fixture!: ResetFixture
    let result!: Pick<Result, 'status' | 'stdout' | 'stderr'>
    await step('the user has two disposable local reset instances with different uploads', async () => { fixture = await twoResetInstances() })
    await step('the user confirms resetting the first local instance', () => { result = fixture.run(['reset', 'acme/shop', '--yes']) })
    await step("only the first instance's database and isolated uploads are removed", async () => {
      expect(result.status, result.stdout + result.stderr).toBe(0)
      await fixture.assertRemoved()
    })
    await step('the other instance and legacy shared uploads remain unchanged', () => fixture.assertPreserved({ selected: false }))
    await step('the user is told to prepare the instance separately', () => {
      expect(result.stdout).toMatch(/Next: featherbase setup/)
      expect(result.stdout).not.toMatch(/Preparing|Migrating|Installing/)
    })
  }, 60_000)

  scenario('Preview before confirming', async (_, step) => {
    let fixture!: ResetFixture
    let result!: Pick<Result, 'status' | 'stdout' | 'stderr'>
    await step('the user has two disposable local reset instances with different uploads', async () => { fixture = await twoResetInstances() })
    await step('the user previews resetting the first local instance', () => { result = fixture.run(['reset']) })
    await step("the reset describes the first instance's database and upload count without changing either instance", async () => {
      expect(result.status).toBe(1)
      expect(result.stdout).toContain(fixture.names[0])
      expect(result.stdout).toContain(fixture.stores[0])
      expect(result.stdout).toMatch(/1 file/)
      expect(result.stderr).toMatch(/--yes/)
      await fixture.assertPreserved()
    })
  }, 60_000)

  scenario('Unsafe targets remain untouched', async (_, step) => {
    let fixture!: ResetFixture
    let results: Pick<Result, 'status' | 'stdout' | 'stderr'>[] = []
    await step('the user has two disposable local reset instances with different uploads', async () => { fixture = await twoResetInstances() })
    await step('the user attempts reset with unsafe target selections', async () => { results = await fixture.attemptUnsafeSelections() })
    await step('every unsafe reset is refused without changing either instance', async () => {
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.status, result.stdout + result.stderr).toBe(1)
        expect(result.stderr).toMatch(/Refusing|development only|only uses one on this machine/)
        expect(result.stdout + result.stderr).not.toMatch(/hidden/)
      }
      await fixture.assertPreserved()
    })
  }, 60_000)
})
