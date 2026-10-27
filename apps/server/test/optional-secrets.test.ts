// #666: an app can mark a secret optional, and each read or action can name
// the secrets it needs. A missing optional secret holds up only what needs
// it; a missing required secret still holds up everything (#620).
// Fixture: runtime-apps/fixtures/optional-secret-proof, an app with an
// optional embed integration.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { test as pgTest } from './pg-test'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { withNamedVariable } from '../src/env'
import { expectApiError } from './fixtures'
import { sql } from '../src/db'
import { declaredAppSecrets } from '../src/app-settings'

const FIXTURE = resolve('../..', 'runtime-apps/fixtures/optional-secret-proof')
const READ = '/api/app_reads/optproof/'
const ACTION = '/api/app_actions/optproof/'
const TOKEN = 'optproof-required-token-1'
const EMBED_KEY = 'optproof-embed-key-2'

const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': 'optproof@1.0.0', ...init?.headers },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

/** Install the fixture and return a reader and the app's handler counter. */
async function installed(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([FIXTURE])).toEqual([])
  await admin.post('/api/install_app', { name: 'optproof' })
  const reader = await createUser({ email: 'optional-reader@example.test', roles: ['Optional Reader'] })
  const digest = availableRuntimeVersions().find(p => p.name === 'optproof')!.digest
  const app = await import(`${pathToFileURL(resolve(FIXTURE, 'server.mjs')).href}?artifact=${digest}`)
  app.calls.handler = 0
  return { reader, calls: app.calls as { handler: number } }
}

/** Run `fn` with the app's required and optional secrets set to these values (undefined: unset). */
const withSecrets = <T>(token: string | undefined, embedKey: string | undefined, fn: () => Promise<T>) =>
  withNamedVariable('OPTPROOF_TOKEN', token, () => withNamedVariable('OPTPROOF_EMBED_KEY', embedKey, fn))

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** A copy of the fixture, its manifest changed by `change`. */
async function fixtureWith(change: (manifest: Record<string, any>) => Record<string, unknown>) {
  const directory = await mkdtemp(resolve('test/.b666-optional-'))
  directories.push(directory)
  await cp(FIXTURE, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  await writeFile(file, JSON.stringify(change(JSON.parse(await readFile(file, 'utf8')))))
  return directory
}

describe('declaring optional secrets and what each operation needs', () => {
  test('a manifest with an optional secret that a read needs is accepted', async () => {
    expect(await discoverPackages([FIXTURE])).toEqual([])
  })

  test('a read that needs a secret the manifest does not declare is refused', async () => {
    const directory = await fixtureWith(manifest => {
      manifest.reads.operations.embed.needs = ['OPTPROOF_MISSING_KEY']
      return manifest
    })
    expect(await discoverPackages([directory])).toEqual([
      expect.objectContaining({ error: 'The read embed needs the secret OPTPROOF_MISSING_KEY, which the app does not declare in its secrets' }),
    ])
  })

  test('an action that needs a secret the manifest does not declare is refused', async () => {
    const directory = await fixtureWith(manifest => {
      manifest.actions.operations.embed_note.needs = ['OPTPROOF_MISSING_KEY']
      return manifest
    })
    expect(await discoverPackages([directory])).toEqual([
      expect.objectContaining({ error: 'The action embed_note needs the secret OPTPROOF_MISSING_KEY, which the app does not declare in its secrets' }),
    ])
  })

  test('a secret whose optional mark is not true or false is refused', async () => {
    const directory = await fixtureWith(manifest => ({ ...manifest, secrets: ['OPTPROOF_TOKEN', { name: 'OPTPROOF_EMBED_KEY', optional: 'yes' }] }))
    expect(await discoverPackages([directory])).toEqual([
      expect.objectContaining({ error: expect.stringContaining('Expected boolean, received string') }),
    ])
  })
})

describe('a missing optional secret', () => {
  test('a read that does not need it runs', async ({ admin, createUser }) => {
    const { reader } = await installed(admin, createUser)
    expect(await withSecrets(TOKEN, undefined, () => reader.post(READ + 'quick_view', { payload: {} })))
      .toEqual({ result: { secrets: ['OPTPROOF_TOKEN'] } })
  })

  test('a read that needs it answers "not set up yet" without running its handler', async ({ admin, createUser }) => {
    const { reader, calls } = await installed(admin, createUser)
    await withSecrets(TOKEN, undefined, () => expectApiError(reader.post(READ + 'embed', { payload: {} }),
      { status: 409, type: 'NotSetUpError', message: expect.stringContaining('Optional secret proof is not set up yet. An administrator needs to finish setting it up.') }))
    expect(calls.handler).toBe(0)
  })

  test('an action that does not need it runs', async ({ admin, createUser }) => {
    const { reader } = await installed(admin, createUser)
    expect(await withSecrets(TOKEN, undefined, () => reader.post(ACTION + 'note', { idempotencyKey: 'n-1', payload: {} })))
      .toEqual({ result: { secrets: ['OPTPROOF_TOKEN'] } })
  })

  test('an action that needs it answers "not set up yet" without running its handler', async ({ admin, createUser }) => {
    const { reader, calls } = await installed(admin, createUser)
    await withSecrets(TOKEN, undefined, () => expectApiError(reader.post(ACTION + 'embed_note', { idempotencyKey: 'e-1', payload: {} }),
      { status: 409, type: 'NotSetUpError' }))
    expect(calls.handler).toBe(0)
  })
})

describe('a missing required secret', () => {
  test('a read that names no secret it needs still answers "not set up yet"', async ({ admin, createUser }) => {
    const { reader, calls } = await installed(admin, createUser)
    await withSecrets(undefined, EMBED_KEY, () => expectApiError(reader.post(READ + 'quick_view', { payload: {} }),
      { status: 409, type: 'NotSetUpError' }))
    expect(calls.handler).toBe(0)
  })
})

describe('a settings export', () => {
  test('knows the value of an optional secret, so it can withhold a setting that holds it', async () => {
    await sql`insert into installed_app (name, manifest, enabled, runtime_package) values ('exportopt',
      ${sql.json({ name: 'exportopt', secrets: [{ name: 'EXPORTOPT_EMBED', optional: true }] })}, true, true)`
    expect(await withNamedVariable('EXPORTOPT_EMBED', 'export-embed-666', () => declaredAppSecrets()))
      .toContainEqual({ name: 'EXPORTOPT_EMBED', value: 'export-embed-666' })
  })
})

// Codex review on #670: an optional secret withheld from an operation is
// still one of the app's secrets. The platform keeps it in exactly as it
// keeps a required one, whatever carries it out (here, a setting).
describe('an optional secret withheld from an operation but set', () => {
  let logged: string[] = []
  beforeEach(() => {
    logged = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(arg => arg instanceof Error ? `${arg.message}\n${arg.stack}` : typeof arg === 'string' ? arg : inspect(arg)).join(' '))
      })
  })
  afterEach(() => { vi.restoreAllMocks() })

  /** Install the app with its caption setting holding the embed key. */
  async function captioned(admin: TestClient, createUser: CreateUserFn) {
    const { reader } = await installed(admin, createUser)
    await sql`insert into app_setting (row_id, app, setting, value) values ('optproof.caption', 'optproof', 'caption', ${`caption-${EMBED_KEY}`})`
    return reader
  }
  const post = (reader: TestClient, path: string, body: unknown) => withSecrets(TOKEN, EMBED_KEY, async () => {
    const response = await reader.fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.text() }
  })

  test('a read answer holding it is withheld', async ({ admin, createUser }) => {
    const reader = await captioned(admin, createUser)
    const { status, body } = await post(reader, READ + 'echo_caption', { payload: {} })
    expect(status).toBe(500)
    expect(body).not.toContain(EMBED_KEY)
  })

  test('an outbound read answer holding it is withheld', async ({ admin, createUser }) => {
    const reader = await captioned(admin, createUser)
    const { status, body } = await post(reader, READ + 'outbound_caption', { payload: {} })
    expect(status).toBe(500)
    expect(body).not.toContain(EMBED_KEY)
  })

  test('an error holding it reaches neither the response nor the log', async ({ admin, createUser }) => {
    const reader = await captioned(admin, createUser)
    const { status, body } = await post(reader, READ + 'throw_caption', { payload: {} })
    expect(status).toBe(500)
    expect(body).not.toContain(EMBED_KEY)
    expect(logged.join('\n')).not.toContain(EMBED_KEY)
  })

  test('a log line holding it is redacted', async ({ admin, createUser }) => {
    const reader = await captioned(admin, createUser)
    expect((await post(reader, READ + 'log_caption', { payload: {} })).status).toBe(200)
    expect(logged.join('\n')).toContain('caption is caption-[secret withheld]')
  })

  test('an action result holding it is neither answered nor stored', async ({ admin, createUser }) => {
    const reader = await captioned(admin, createUser)
    const { status, body } = await post(reader, ACTION + 'echo_caption', { idempotencyKey: 'leak', payload: {} })
    expect(status).toBe(500)
    expect(body).not.toContain(EMBED_KEY)
    expect(JSON.stringify(await sql`select result from runtime_action_result where app = 'optproof'`)).not.toContain(EMBED_KEY)
  })
})

describe('with every secret set', () => {
  test('a read that needs the optional secret gets it', async ({ admin, createUser }) => {
    const { reader } = await installed(admin, createUser)
    expect(await withSecrets(TOKEN, EMBED_KEY, () => reader.post(READ + 'embed', { payload: {} })))
      .toEqual({ result: { secrets: ['OPTPROOF_EMBED_KEY', 'OPTPROOF_TOKEN'] } })
  })

  test('a read that does not need the optional secret is not given it', async ({ admin, createUser }) => {
    const { reader } = await installed(admin, createUser)
    expect(await withSecrets(TOKEN, EMBED_KEY, () => reader.post(READ + 'quick_view', { payload: {} })))
      .toEqual({ result: { secrets: ['OPTPROOF_TOKEN'] } })
  })

  test('a read that reaches an optional secret it does not declare it needs is refused', async ({ admin, createUser }) => {
    const { reader } = await installed(admin, createUser)
    await withSecrets(TOKEN, EMBED_KEY, () => expectApiError(reader.post(READ + 'reach_embed', { payload: {} }),
      { status: 500, type: 'InternalError', message: expect.stringContaining('Optional secret proof used a secret this read or action does not declare it needs. The app needs to declare it.') }))
  })
})
