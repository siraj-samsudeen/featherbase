// #620 (design E2): an app declares the settings and secrets it needs. Values
// live in the App Setting security Table (set through the instance settings
// file); secrets stay deployment variables. Handlers get only what was
// declared, and a missing required value is "not set up yet", never a crash.
// Fixture: test-apps/fixtures/setup-proof-v1.
import { resolve } from 'node:path'
import { inspect } from 'node:util'
import { pathToFileURL } from 'node:url'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { test as pgTest } from './pg-test'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { withNamedVariable } from '../src/env'
import { sql } from '../src/db'
import { expectApiError } from './fixtures'
import { applyInstanceSettings, exportInstanceSettings } from '../src/instance-settings'
import { WITHHELD_ANSWER, WITHHELD_MESSAGE, keptSecrets, withSecretsKept } from '../src/app-settings'

const fixture = resolve('../..', 'test-apps/fixtures/setup-proof-v1')
const read = '/api/app_reads/setupproof/'
const TOKEN = 'fixture-token-6f1c2a'
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': 'setupproof@1.0.0', ...init?.headers },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

async function fixtureModule() {
  const digest = availableRuntimeVersions().find(p => p.name === 'setupproof')!.digest
  return import(`${pathToFileURL(resolve(fixture, 'server.mjs')).href}?artifact=${digest}`)
}

async function setup(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([fixture])).toEqual([])
  await admin.post('/api/install_app', { name: 'setupproof' })
  const reader = await createUser({ email: 'reader@example.test', roles: ['Setup Reader'] })
  const app = await fixtureModule()
  app.calls.handler = 0
  return { reader, app }
}

const setting = (admin: TestClient, name: string, value: string) =>
  admin.post('/api/save_row', { table: 'App Setting', row: { row_id: `setupproof.${name}`, value } })

describe('declared app settings', () => {
  test('the handler gets the declared settings that hold a value', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    const answer = await withNamedVariable('SETUPPROOF_TOKEN', TOKEN, () => reader.post(read + 'config', { payload: {} }))
    expect(answer).toEqual({ result: { settings: { report_id: 'R-1' }, secrets: ['SETUPPROOF_TOKEN'] } })
  })

  test('a stored value for a setting the app does not declare never reaches the handler', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    await sql`insert into app_setting (row_id, app, setting, value) values ('setupproof.retired', 'setupproof', 'retired', 'old')`
    const answer = await withNamedVariable('SETUPPROOF_TOKEN', TOKEN, () => reader.post(read + 'config', { payload: {} }))
    expect(answer).toEqual({ result: { settings: { report_id: 'R-1' }, secrets: ['SETUPPROOF_TOKEN'] } })
  })

  test('saving a setting the app does not declare is refused', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await expectApiError(setting(admin, 'retired', 'old'), { status: 417, message: expect.stringMatching(/does not declare the setting retired/) })
  })
})

describe('an app that is not set up yet', () => {
  test('a read before its required setting is filled in answers "not set up yet" without running the handler', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await withNamedVariable('SETUPPROOF_TOKEN', TOKEN, () => expectApiError(reader.post(read + 'config', { payload: {} }),
      { status: 409, type: 'NotSetUpError', message: expect.stringContaining('Setup proof is not set up yet. An administrator needs to finish setting it up.') }))
    expect(app.calls.handler).toBe(0)
  })

  test('a missing secret also answers "not set up yet"', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    await withNamedVariable('SETUPPROOF_TOKEN', undefined, () => expectApiError(reader.post(read + 'config', { payload: {} }),
      { status: 409, type: 'NotSetUpError' }))
    expect(app.calls.handler).toBe(0)
  })

  test('an action before setup is finished answers "not set up yet" and stores no result', async ({ admin, createUser }) => {
    const { reader, app } = await setup(admin, createUser)
    await withNamedVariable('SETUPPROOF_TOKEN', TOKEN, () => expectApiError(
      reader.post('/api/app_actions/setupproof/record', { idempotencyKey: 'first', payload: {} }), { status: 409, type: 'NotSetUpError' }))
    expect(app.calls.handler).toBe(0)
    expect(await sql`select 1 from runtime_action_result where app = 'setupproof'`).toHaveLength(0)
  })
})

describe('an app secret', () => {
  let logged: string[] = []
  beforeEach(() => {
    logged = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(arg => arg instanceof Error ? `${arg.message}\n${arg.stack}` : typeof arg === 'string' ? arg : inspect(arg)).join(' '))
      })
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function call(reader: TestClient, name: string, token = TOKEN) {
    const response = await withNamedVariable('SETUPPROOF_TOKEN', token, () => reader.fetch(read + name, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: {} }) }))
    return { status: response.status, body: await response.text() }
  }

  test('a handler that returns its secret has its answer withheld', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    const { status, body } = await call(reader, 'echo_secret')
    expect(status).toBe(500)
    expect(body).not.toContain(TOKEN)
    expect(JSON.parse(body)).toEqual({ error: { type: 'InternalError', message: 'The app\'s answer was withheld: it held one of the app\'s secrets' } })
  })

  test('a handler error that carries its secret reaches neither the response nor the log', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    const { status, body } = await call(reader, 'fail_with_secret')
    expect(status).toBe(500)
    expect(body).not.toContain(TOKEN)
    expect(logged.join('\n')).not.toContain(TOKEN)
  })

  test('a refusal message that carries its secret is withheld from the response', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    const { status, body } = await call(reader, 'reject_with_secret')
    expect(status).toBe(417)
    expect(body).not.toContain(TOKEN)
  })

  test('an action that returns its secret stores no result holding it', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    // The fixture's record action echoes its settings; the secret goes in a setting here.
    await setting(admin, 'theme', TOKEN)
    const response = await withNamedVariable('SETUPPROOF_TOKEN', TOKEN, () => reader.fetch('/api/app_actions/setupproof/record', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'leak', payload: {} }) }))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(TOKEN)
    expect(JSON.stringify(await sql`select result from runtime_action_result where app = 'setupproof'`)).not.toContain(TOKEN)
  })

  // Codex review on #623: a secret that JSON or inspect would escape.
  const ESCAPED = [
    ['spans two lines', 'line-one\nline-two-620'],
    ['holds a quote', 'quote"token-620'],
    ['holds a backslash', 'back\\slash-620'],
  ] as const

  test.for(ESCAPED)('a read answer holding a secret that %s is withheld', async ([, token], { admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    const { status, body } = await call(reader, 'echo_secret', token)
    expect(status).toBe(500)
    expect(JSON.parse(body)).toEqual({ error: { type: 'InternalError', message: WITHHELD_ANSWER } })
  })

  test.for(ESCAPED)('an action answer holding a secret that %s is withheld and not stored', async ([, token], { admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    const response = await withNamedVariable('SETUPPROOF_TOKEN', token, () => reader.fetch('/api/app_actions/setupproof/echo_secret', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'escaped', payload: {} }) }))
    expect(response.status).toBe(500)
    expect(await sql`select 1 from runtime_action_result where app = 'setupproof'`).toHaveLength(0)
  })

  test.for(ESCAPED)('an error holding a secret that %s is replaced before it is answered or logged', async ([, token], { admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    const { status, body } = await call(reader, 'fail_with_secret', token)
    expect(status).toBe(500)
    expect(body).not.toContain('-620')
    expect(logged.join('\n')).toContain(WITHHELD_MESSAGE)
    expect(logged.join('\n')).not.toContain('upstream refused token')
  })

  test('a handler that logs its secret and then answers has the secret redacted from the log', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    const { status } = await call(reader, 'log_secret')
    expect(status).toBe(200)
    expect(logged.join('\n')).toContain('calling upstream with [secret withheld]')
    expect(logged.join('\n')).not.toContain(TOKEN)
  })

  test('a handler that logs its secret and then throws has the secret redacted from the log', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    const { status } = await call(reader, 'log_then_throw')
    expect(status).toBe(500)
    expect(logged.join('\n')).toContain('[secret withheld]')
    expect(logged.join('\n')).not.toContain(TOKEN)
  })

  test('two apps running at once each have only their own secret redacted', async () => {
    const first = withSecretsKept(keptSecrets({ FIRST_TOKEN: 'first-secret-620' }), async () => {
      await new Promise(done => setTimeout(done, 20))
      console.log('first: first-secret-620')
    })
    const second = withSecretsKept(keptSecrets({ SECOND_TOKEN: 'second-secret-620' }), async () => {
      console.log('second: second-secret-620, not first-secret-620')
      await new Promise(done => setTimeout(done, 40))
    })
    await Promise.all([first, second])
    console.log('afterwards: first-secret-620')
    expect(logged).toEqual([
      'second: [secret withheld], not first-secret-620',
      'first: [secret withheld]',
      'afterwards: first-secret-620',
    ])
  })

  // Codex round 2 on #623: console prints values a key walk cannot see.
  class Inner { constructor(readonly token: string) {} }
  class Outer { constructor(readonly inner: Inner) {} }
  const PLAIN = 'plain-secret-620'
  test.for([
    ['a Headers', (): unknown => new Headers({ authorization: `Bearer ${PLAIN}` })],
    ['a Map', (): unknown => new Map([['token', PLAIN]])],
    ['a Set', (): unknown => new Set([PLAIN])],
    ['a nested class instance', (): unknown => new Outer(new Inner(PLAIN))],
    ['a format string', (): unknown => PLAIN],
  ] as const)('a handler logging %s has the secret redacted', async ([label, make]) => {
    await withSecretsKept(keptSecrets({ TOKEN: PLAIN }), async () => {
      if (label === 'a format string') console.log('token: %s', make())
      else console.log(make())
    })
    expect(logged.join('\n')).toContain('[secret withheld]')
    expect(logged.join('\n')).not.toContain(PLAIN)
  })

  test.for(ESCAPED)('a handler logging JSON text of a secret that %s has it redacted', async ([, token]) => {
    await withSecretsKept(keptSecrets({ TOKEN: token }), async () => { console.log(JSON.stringify({ token })) })
    expect(logged).toEqual(['{"token":"[secret withheld]"}'])
  })

  test('an error whose message getter throws cannot leak the app secret', async () => {
    const failure = { get message(): string { throw new Error(PLAIN) } }
    await expect(withSecretsKept(keptSecrets({ TOKEN: PLAIN }), async () => { throw failure }))
      .rejects.toThrow("The app's message was withheld: it held one of the app's secrets")
    expect(logged.join('\n')).not.toContain(PLAIN)
  })

  test('outside an app handler the console is left alone', async () => {
    await withSecretsKept(keptSecrets({ TOKEN: PLAIN }), async () => {})
    console.log('count', 3, { a: 1 })
    expect(logged).toEqual([`count 3 ${inspect({ a: 1 })}`])
  })

  test('the Access Log never records it', async ({ admin, createUser }) => {
    const { reader } = await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-1')
    for (const name of ['echo_secret', 'fail_with_secret', 'reject_with_secret']) await call(reader, name)
    const outsider = await createUser({ email: 'outsider@example.test', roles: [] })
    await call(outsider, 'config')
    expect(JSON.stringify(await sql`select * from access_log`)).not.toContain(TOKEN)
  })
})

describe('the settings file sets app settings', () => {
  const file = (value: string) => ({ settings: { 'App Setting': [{ row_id: 'setupproof.report_id', value }] } })

  test('an apply fills in the app\'s setting', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const result = await applyInstanceSettings(file('R-9'), { by: 'Administrator' })
    expect(result.changes).toEqual([{ table: 'App Setting', row_id: 'setupproof.report_id', field: 'value', old: null, new: 'R-9', created: true }])
    expect(await sql`select app, setting, value from app_setting`).toEqual([{ app: 'setupproof', setting: 'report_id', value: 'R-9' }])
  })

  test('a dry run reports the change and writes nothing', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const result = await applyInstanceSettings(file('R-9'), { by: 'Administrator', dryRun: true })
    expect(result.summary).toBe('1 setting would change')
    expect(await sql`select 1 from app_setting`).toHaveLength(0)
  })

  test('a file naming a setting the app does not declare is refused whole', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await expect(applyInstanceSettings({ settings: { 'App Setting': [
      { row_id: 'setupproof.report_id', value: 'R-9' }, { row_id: 'setupproof.retired', value: 'x' },
    ] } }, { by: 'Administrator' })).rejects.toMatchObject({ fields: { 'App Setting.setupproof.retired.row_id': expect.stringMatching(/does not declare the setting retired/) } })
    expect(await sql`select 1 from app_setting`).toHaveLength(0)
  })

  test('an export writes the app\'s settings in the file\'s shape', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await setting(admin, 'report_id', 'R-9')
    expect((await exportInstanceSettings()).file.settings['App Setting']).toEqual([{ row_id: 'setupproof.report_id', value: 'R-9' }])
  })

  test('an export withholds a setting that holds the value of one of the app\'s secrets', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await setting(admin, 'report_id', `prefix-${TOKEN}`)
    const exported = await withNamedVariable('SETUPPROOF_TOKEN', TOKEN, () => exportInstanceSettings())
    expect(JSON.stringify(exported)).not.toContain(TOKEN)
    expect(exported.withheld).toEqual(['App Setting.setupproof.report_id.value: holds the value of SETUPPROOF_TOKEN'])
  })

  test('an export withholds a setting that holds a short secret value', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await setting(admin, 'report_id', 'id-k9z')
    const exported = await withNamedVariable('SETUPPROOF_TOKEN', 'k9z', () => exportInstanceSettings())
    expect(exported.file.settings['App Setting']).toEqual([{ row_id: 'setupproof.report_id' }])
    expect(exported.withheld).toEqual(['App Setting.setupproof.report_id.value: holds the value of SETUPPROOF_TOKEN'])
  })

  test('once the file sets a setting, Admin cannot change it', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await applyInstanceSettings(file('R-9'), { by: 'Administrator' })
    const [row] = await sql`select updated_at from app_setting where row_id = 'setupproof.report_id'`
    await expectApiError(admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'setupproof.report_id', value: 'R-0', updated_at: row.updated_at } }),
      { status: 403, message: expect.stringMatching(/set in the instance settings file/) })
  })
})
