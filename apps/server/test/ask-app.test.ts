// Feather Ask (#1377), installed from its folder: anyone signed in saves a question with
// the answer think gave, in their own chat; the action refuses what the page refuses too,
// and an answer that isn't one, and saves nothing then.
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { sandboxRequest } from './pg-test-shared'
import { expectRefused, expectStatus } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'
import { MAX_ANSWER_LENGTH, MAX_QUESTION_LENGTH } from '../../../example-apps/ask/src/shared/reply'
import pkg from '../../../example-apps/ask/package.json'

const directory = resolve('../..', 'example-apps/ask')
const ACTION = '/api/app_actions/ask/ask'
// Ask's page names its version on every call; the platform refuses any other (403).
const VERSION = { 'X-Featherbase-App-Version': `ask@${pkg.version}` }
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, ...VERSION },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

// Install Ask, then two people with no roles at all: Ask is open to everyone signed in.
async function setup(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'ask' })
  const person = (name: string) => createUser({ email: `${name}@ask.example.test`, roles: [] })
  return { selvi: await person('selvi'), ravi: await person('ravi') }
}
type Asked = { chat: string; answer: { kind: string; text: string } }
// The answer think gives; the page passes it on to the action.
const THOUGHT = { kind: 'answer', text: 'You have 3 tickets.' }
// The platform wraps the action's { chat, answer } in { result }.
const ask = async (client: TestClient, question: unknown, chat?: string, answer: unknown = THOUGHT) =>
  (await client.post<any>(ACTION, { idempotencyKey: randomUUID(), payload: { question, chat, answer } })).result as Asked
// What this person may read of one of Ask's Tables.
const rows = async (client: TestClient, table: string, fields: string[]) =>
  (await client.get<any>(`/api/table/${encodeURIComponent(table)}?fields=${encodeURIComponent(JSON.stringify(fields))}`)).data as Record<string, unknown>[]

describe('Feather Ask: asking (#1377)', () => {
  test('anyone signed in saves the answer think gave, in a new chat titled by the question', async ({ admin, createUser }) => {
    const { selvi } = await setup(admin, createUser)
    const asked = await ask(selvi, '  Did I meet my target this month?  ')
    expect(asked.answer).toEqual(THOUGHT)
    expect(await rows(selvi, 'ask.chat', ['row_id', 'title'])).toEqual([{ row_id: asked.chat, title: 'Did I meet my target this month?' }])
    expect(await rows(selvi, 'ask.question', ['chat', 'question', 'answer', 'answer_kind'])).toEqual([
      { chat: asked.chat, question: 'Did I meet my target this month?', answer: asked.answer.text, answer_kind: 'answer' },
    ])
  })

  test('a question naming the chat joins it; the chat keeps its first title', async ({ admin, createUser }) => {
    const { selvi } = await setup(admin, createUser)
    const first = await ask(selvi, 'Did I meet my target?')
    const second = await ask(selvi, 'And last month?', first.chat)
    expect(second.chat).toBe(first.chat)
    expect(await rows(selvi, 'ask.chat', ['title'])).toEqual([{ title: 'Did I meet my target?' }])
    expect((await rows(selvi, 'ask.question', ['question'])).map((row) => row.question).sort()).toEqual(['And last month?', 'Did I meet my target?'])
  })

  test('a long first question gives a title cut to 140 characters, on one line', async ({ admin, createUser }) => {
    const { selvi } = await setup(admin, createUser)
    await ask(selvi, `First line\n${'x'.repeat(200)}`)
    const [{ title }] = await rows(selvi, 'ask.chat', ['title'])
    expect(title).toBe(`First line ${'x'.repeat(129)}`)
  })

  test("each person sees only their own chats, and nobody adds to someone else's", async ({ admin, createUser }) => {
    const { selvi, ravi } = await setup(admin, createUser)
    const mine = await ask(selvi, 'Did I meet my target?')
    expect(await rows(ravi, 'ask.chat', ['row_id'])).toEqual([])
    expect(await rows(ravi, 'ask.question', ['row_id'])).toEqual([])
    await expectRefused(ask(ravi, 'Sneaking in', mine.chat), 403)
    expect(await rows(selvi, 'ask.question', ['question'])).toEqual([{ question: 'Did I meet my target?' }])
    // Ravi is refused that chat only: in a chat of his own he is answered.
    expect((await ask(ravi, 'My own question')).answer.kind).toBe('answer')
  })

  test('an empty question, or one over the limit, is refused and nothing is saved', async ({ admin, createUser }) => {
    const { selvi } = await setup(admin, createUser)
    await expectRefused(ask(selvi, '   \n  '), 417, 'Type a question first')
    await expectRefused(ask(selvi, undefined), 417, 'Type a question first')
    await expectRefused(ask(selvi, 'x'.repeat(MAX_QUESTION_LENGTH + 1)), 417, `under ${MAX_QUESTION_LENGTH} characters`)
    expect(await rows(selvi, 'ask.chat', ['row_id'])).toEqual([])
    expect((await ask(selvi, 'x'.repeat(MAX_QUESTION_LENGTH))).answer.kind).toBe('answer')
  })

  test("an answer that isn't one, or is over the limit, is refused and nothing is saved", async ({ admin, createUser }) => {
    const { selvi } = await setup(admin, createUser)
    await expectRefused(ask(selvi, 'Did I meet my target?', undefined, null), 417, 'no answer to save')
    await expectRefused(ask(selvi, 'Did I meet my target?', undefined, { kind: 'shout', text: 'Hi' }), 417, 'no answer to save')
    await expectRefused(ask(selvi, 'Did I meet my target?', undefined, { kind: 'answer', text: '  ' }), 417, 'no answer to save')
    await expectRefused(ask(selvi, 'Did I meet my target?', undefined, { kind: 'answer', text: 'x'.repeat(MAX_ANSWER_LENGTH + 1) }), 417, `under ${MAX_ANSWER_LENGTH} characters`)
    expect(await rows(selvi, 'ask.chat', ['row_id'])).toEqual([])
    const cannot = { kind: 'cannot', text: "I couldn't answer that." }
    expect((await ask(selvi, 'What is the weather?', undefined, cannot)).answer).toEqual(cannot)
  })

  test('a signed-out caller is refused', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const response = await sandboxRequest(ACTION, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...VERSION },
      body: JSON.stringify({ idempotencyKey: randomUUID(), payload: { question: 'Did I meet my target?' } }),
    })
    await expectStatus(response, 401)
  })
})
