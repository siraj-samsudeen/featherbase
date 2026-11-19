// The language model that turns questions into plans: one call to the
// Anthropic Messages API, answered here by a local stand-in server.
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { overrideVariable, withNamedVariable } from '../src/env'
import { DEFAULT_ANALYST_MODEL, SAFETY_RULES, planModel, usePlanModel } from '../src/plan-model'
import { assertAllowance, recordUsage } from '../src/model-usage'

// The month's allowance and the record of use have their own tests (model-usage.test.ts); here they are watched.
vi.mock('../src/model-usage', () => ({ assertAllowance: vi.fn(async () => {}), recordUsage: vi.fn(async () => {}) }))

let reply = { status: 200, body: '' }
const seen: { url?: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = []
const server = createServer(async (request, response) => {
  let data = ''
  for await (const chunk of request) data += chunk
  seen.push({ url: request.url, headers: request.headers, body: JSON.parse(data) })
  response.writeHead(reply.status, { 'content-type': 'application/json' })
  response.end(reply.body)
})
let base = ''
// A developer's apps/server/.env (loaded at import) may hold a real key or
// workspace; these tests start from none of them and put them back after.
const NAMES = ['ANTHROPIC_API_KEY', 'ANALYST_API_BASE', 'ANALYST_MODEL', 'ANTHROPIC_WORKSPACE_ID'] as const
const saved = new Map(NAMES.map(name => [name, process.env[name]]))
beforeAll(async () => {
  for (const name of NAMES) delete process.env[name]
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => {
  for (const [name, value] of saved) if (value !== undefined) process.env[name] = value
  await new Promise(resolve => server.close(resolve))
})
afterEach(() => {
  for (const name of NAMES) overrideVariable(name, undefined)
  usePlanModel(undefined)
  seen.length = 0
  vi.mocked(assertAllowance).mockClear()
  vi.mocked(recordUsage).mockClear()
})
const configure = (address = base) => {
  overrideVariable('ANTHROPIC_API_KEY', ' test-key ')
  overrideVariable('ANALYST_API_BASE', `${address}/`)
}
const text = (...parts: unknown[]) => ({ status: 200, body: JSON.stringify({ content: parts }) })

describe('the plan model', () => {
  test('sends the question under the system prompt, with the key, and returns the reply\'s text', async () => {
    configure()
    reply = text({ type: 'text', text: '{"plan":' }, { type: 'tool_use' }, { type: 'text', text: '{}}' })
    expect(await planModel().complete({ system: 'S', question: 'Q' })).toBe('{"plan":{}}')
    expect(seen).toMatchObject([{ url: '/v1/messages', headers: { 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' },
      body: { model: DEFAULT_ANALYST_MODEL, system: `S\n\n${SAFETY_RULES}`, messages: [{ role: 'user', content: 'Q' }] } }])
    // A reply that reports no use records none.
    expect(recordUsage).not.toHaveBeenCalled()
  })

  test('what a call used is kept, whether or not its reply can be used', async () => {
    configure()
    reply = { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 120, output_tokens: 30 } }) }
    await planModel().complete({ system: 'S', question: 'Q' })
    expect(recordUsage).toHaveBeenCalledWith(DEFAULT_ANALYST_MODEL, 120, 30)
    reply = { status: 200, body: JSON.stringify({ content: [], usage: { input_tokens: 7 } }) }
    await expect(planModel().complete({ system: 'S', question: 'Q' })).rejects.toMatchObject({ type: 'ServiceUnavailableError' })
    expect(recordUsage).toHaveBeenLastCalledWith(DEFAULT_ANALYST_MODEL, 7, 0)
  })

  test('the month\'s allowance is checked before anything is sent', async () => {
    configure()
    vi.mocked(assertAllowance).mockRejectedValueOnce(new Error('used up'))
    await expect(planModel().complete({ system: 'S', question: 'Q' })).rejects.toThrow('used up')
    expect(seen).toEqual([])
  })

  test('ANTHROPIC_WORKSPACE_ID is sent as the workspace, and only when set', async () => {
    configure()
    reply = text({ type: 'text', text: 'ok' })
    await planModel().complete({ system: 'S', question: 'Q' })
    expect(seen[0].headers).not.toHaveProperty('anthropic-workspace-id')
    overrideVariable('ANTHROPIC_WORKSPACE_ID', ' wrkspc_01 ')
    await planModel().complete({ system: 'S', question: 'Q' })
    expect(seen[1].headers['anthropic-workspace-id']).toBe('wrkspc_01')
  })

  test('earlier questions go first, each with the reply it got', async () => {
    configure()
    reply = text({ type: 'text', text: 'ok' })
    await planModel().complete({ system: 'S', question: 'And by store?', history: [{ question: 'Sales?', reply: '{"plan":{}}' }] })
    expect(seen[0].body.messages).toEqual([{ role: 'user', content: 'Sales?' }, { role: 'assistant', content: '{"plan":{}}' },
      { role: 'user', content: 'And by store?' }])
  })

  test('ANALYST_MODEL picks the model', async () => {
    configure()
    overrideVariable('ANALYST_MODEL', 'claude-haiku-5-5')
    reply = text({ type: 'text', text: 'ok' })
    await planModel().complete({ system: 'S', question: 'Q' })
    expect(seen[0].body.model).toBe('claude-haiku-5-5')
  })

  test.for([
    ['an error status', { status: 500, body: '{"error":"the request echoed"}' }],
    ['a body that is not JSON', { status: 200, body: 'not json' }],
    ['a reply with no text', { status: 200, body: '{"content":[]}' }],
  ] as const)('%s is "did not answer", never passed on', async ([, answer]) => {
    configure()
    reply = answer
    await expect(planModel().complete({ system: 'S', question: 'Q' })).rejects.toMatchObject({ type: 'ServiceUnavailableError', message: expect.not.stringContaining('echoed') })
  })

  test('the server log says why the provider refused, without its message', async () => {
    configure()
    reply = { status: 401, body: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(planModel().complete({ system: 'S', question: 'Q' })).rejects.toMatchObject({ type: 'ServiceUnavailableError' })
    expect(warn).toHaveBeenCalledWith('[analyst] the language model refused: HTTP 401 authentication_error')
    warn.mockRestore()
  })

  test('an address that does not answer is "did not answer"', async () => {
    configure('http://127.0.0.1:1')
    await expect(planModel().complete({ system: 'S', question: 'Q' })).rejects.toMatchObject({ type: 'ServiceUnavailableError' })
  })

  test('without a key it is not set up', async () => {
    await withNamedVariable('ANTHROPIC_API_KEY', undefined, async () => {
      expect(() => planModel()).toThrow('Asking questions in words is not set up on this instance')
    })
  })

  test('a stand-in, when set, answers instead, behind the same guardrails', async () => {
    const asked: string[] = []
    usePlanModel({ complete: async (prompt) => { asked.push(prompt.system); return 'stood in' } })
    expect(await planModel().complete({ system: 'S', question: 'Q' })).toBe('stood in')
    expect(asked).toEqual([`S\n\n${SAFETY_RULES}`])
    expect(assertAllowance).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([])
  })
})
