// Feather Ask (#1377), installed from its folder: anyone signed in asks a question
// and gets the placeholder answer; the read refuses what the page refuses too.
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { sandboxRequest } from './pg-test-shared'
import { expectRefused, expectStatus } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'
import { MAX_QUESTION_LENGTH } from '../../../example-apps/ask/src/shared/reply'
import pkg from '../../../example-apps/ask/package.json'

const directory = resolve('../..', 'example-apps/ask')
const READ = '/api/app_reads/ask/ask'
// Ask's page names its version on every call; the platform refuses any other (403).
const VERSION = { 'X-Featherbase-App-Version': `ask@${pkg.version}` }
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, ...VERSION },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

// Install Ask, then a person with no roles at all: Ask is open to everyone signed in.
async function setup(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'ask' })
  return createUser({ email: 'selvi@ask.example.test', roles: [] })
}
// The platform wraps the read's { answer } in { result }.
const ask = async (client: TestClient, question: unknown) =>
  (await client.post<any>(READ, { payload: { question } })).result.answer

describe('Feather Ask: the ask read (#1377)', () => {
  test('anyone signed in gets the placeholder answer', async ({ admin, createUser }) => {
    const selvi = await setup(admin, createUser)
    expect(await ask(selvi, '  Did I meet my target this month?  ')).toEqual({
      kind: 'answer',
      text: expect.stringContaining('placeholder answer'),
    })
  })

  test('an empty question is refused', async ({ admin, createUser }) => {
    const selvi = await setup(admin, createUser)
    await expectRefused(ask(selvi, '   \n  '), 417, 'Type a question first')
    await expectRefused(ask(selvi, undefined), 417, 'Type a question first')
  })

  test('a question over the limit is refused; one at the limit is answered', async ({ admin, createUser }) => {
    const selvi = await setup(admin, createUser)
    await expectRefused(ask(selvi, 'x'.repeat(MAX_QUESTION_LENGTH + 1)), 417, `under ${MAX_QUESTION_LENGTH} characters`)
    expect((await ask(selvi, 'x'.repeat(MAX_QUESTION_LENGTH))).kind).toBe('answer')
  })

  test('a signed-out caller is refused', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const response = await sandboxRequest(READ, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...VERSION },
      body: JSON.stringify({ payload: { question: 'Did I meet my target?' } }),
    })
    await expectStatus(response, 401)
  })
})
