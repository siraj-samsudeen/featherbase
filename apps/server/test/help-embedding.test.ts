// The embedding model that finds help passages near a question: calls to
// Voyage AI's embeddings API, answered here by a local stand-in server.
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { overrideVariable } from '../src/env'
import { DEFAULT_LOCAL_MODEL, DEFAULT_VOYAGE_MODEL, EMBEDDING_BATCH, LOCAL_BATCH, embeddingModel, localModel, useEmbeddingModel } from '../src/help-embedding'

let reply: (input: string[]) => { status: number; body: string } = () => ({ status: 200, body: '' })
const seen: { url?: string; headers: IncomingHttpHeaders; body: { model: string; input: string[]; input_type: string } }[] = []
const server = createServer(async (request, response) => {
  let data = ''
  for await (const chunk of request) data += chunk
  const body = JSON.parse(data)
  seen.push({ url: request.url, headers: request.headers, body })
  const { status, body: out } = reply(body.input)
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(out)
})
let base = ''
// A developer's apps/server/.env may hold a real key; these tests start from none and put it back after.
const NAMES = ['EMBEDDING_PROVIDER', 'VOYAGE_API_KEY', 'EMBEDDING_MODEL', 'EMBEDDING_API_BASE', 'EMBEDDING_CACHE'] as const
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
  useEmbeddingModel(undefined)
  seen.length = 0
})
const configure = (address = base) => {
  overrideVariable('EMBEDDING_PROVIDER', ' Voyage ')
  overrideVariable('VOYAGE_API_KEY', ' voyage-key ')
  overrideVariable('EMBEDDING_API_BASE', `${address}/`)
}
// Each text's vector is [its length, its position in the request], returned in reverse to show order is restored.
const vectors = (input: string[]) => ({ status: 200, body: JSON.stringify({ data: input.map((text, index) => ({ embedding: [text.length, index], index })).reverse() }) })

describe('the Voyage embedding model', () => {
  test('sends the texts with the key, the model and whether they are passages or a question, and returns one vector each, in order', async () => {
    configure()
    reply = vectors
    const model = embeddingModel()
    expect(model.name).toBe(DEFAULT_VOYAGE_MODEL)
    expect(await model.embed(['a', 'bbb'], 'document')).toEqual([[1, 0], [3, 1]])
    expect(seen).toMatchObject([{ url: '/v1/embeddings', headers: { authorization: 'Bearer voyage-key' },
      body: { model: 'voyage-4', input: ['a', 'bbb'], input_type: 'document' } }])
    overrideVariable('EMBEDDING_MODEL', ' voyage-4-lite ')
    expect(await embeddingModel().embed(['q'], 'query')).toEqual([[1, 0]])
    expect(seen[1].body).toEqual({ model: 'voyage-4-lite', input: ['q'], input_type: 'query' })
  })

  test('many texts go in batches, and come back as one list in order', async () => {
    configure()
    reply = vectors
    const texts = Array.from({ length: EMBEDDING_BATCH + 6 }, (_, i) => 'x'.repeat(i + 1))
    const got = await embeddingModel().embed(texts, 'document')
    expect(seen.map(call => call.body.input.length)).toEqual([EMBEDDING_BATCH, 6])
    expect(got.map(vector => vector[0])).toEqual(texts.map(text => text.length))
  })

  test.for<[string, (input: string[]) => { status: number; body: string }]>([
    ['a refusal', () => ({ status: 401, body: '{"detail":"bad key voyage-key"}' })],
    ['a reply that is not JSON', () => ({ status: 200, body: 'oops' })],
    ['too few vectors', () => ({ status: 200, body: JSON.stringify({ data: [] }) })],
    ['a vector that is not numbers', input => ({ status: 200, body: JSON.stringify({ data: input.map((_, index) => ({ embedding: ['x'], index })) }) })],
    ['an empty vector', input => ({ status: 200, body: JSON.stringify({ data: input.map((_, index) => ({ embedding: [], index })) }) })],
  ])('%s is "did not answer", and the provider\'s words are not passed on', async ([, answer]) => {
    configure()
    reply = answer
    const refusal = await embeddingModel().embed(['a'], 'query').then(() => undefined, error => error)
    expect(refusal).toMatchObject({ type: 'ServiceUnavailableError', message: 'Help did not answer. Try again in a minute.' })
  })

  test('an address that does not answer is "did not answer"', async () => {
    configure('http://127.0.0.1:1')
    await expect(embeddingModel().embed(['a'], 'query')).rejects.toMatchObject({ type: 'ServiceUnavailableError' })
  })

  test('without a key Voyage is not set up, and a provider that is neither is refused; a stand-in takes the real model\'s place', async () => {
    overrideVariable('EMBEDDING_PROVIDER', 'voyage')
    expect(() => embeddingModel()).toThrow('Help is not set up on this instance: VOYAGE_API_KEY is not set')
    overrideVariable('EMBEDDING_PROVIDER', 'cloud')
    expect(() => embeddingModel()).toThrow('EMBEDDING_PROVIDER must be local or voyage')
    const standIn = { name: 'stand-in', embed: async () => [[1]] }
    useEmbeddingModel(standIn)
    expect(embeddingModel()).toBe(standIn)
  })
})

// The model run inside the server. What loads it is a stand-in here: the real
// one downloads the model first (src/help-embedding-local.ts).
describe('the local embedding model', () => {
  const extractor = (seen: string[][]) => async (texts: string[], options: unknown) => {
    seen.push(texts)
    expect(options).toEqual({ pooling: 'cls', normalize: true })
    return { tolist: () => texts.map(text => [text.length, 1]) }
  }

  test('is the default, with no key: Snowflake\'s Arctic Embed M v2.0, or the model EMBEDDING_MODEL names', () => {
    expect(embeddingModel().name).toBe(DEFAULT_LOCAL_MODEL)
    expect(DEFAULT_LOCAL_MODEL).toBe('Snowflake/snowflake-arctic-embed-m-v2.0')
    overrideVariable('EMBEDDING_PROVIDER', ' LOCAL ')
    overrideVariable('EMBEDDING_MODEL', ' Snowflake/snowflake-arctic-embed-l-v2.0 ')
    expect(embeddingModel().name).toBe('Snowflake/snowflake-arctic-embed-l-v2.0')
  })

  test('embeds a passage as it is and a question marked as a query, no more than a batch at a time, loading the model once', async () => {
    const seen: string[][] = []
    let loads = 0
    const model = localModel('proof/once', async () => { loads++; return extractor(seen) })
    const passages = Array.from({ length: LOCAL_BATCH + 2 }, (_, i) => 'p'.repeat(i + 1))
    expect((await model.embed(passages, 'document')).map(vector => vector[0])).toEqual(passages.map(text => text.length))
    expect(seen.every(batch => batch.length <= LOCAL_BATCH)).toBe(true)
    expect(seen.flat()).toEqual(passages)
    expect(await model.embed(['why?'], 'query')).toEqual([[11, 1]])
    expect(seen.at(-1)).toEqual(['query: why?'])
    expect(loads).toBe(1)
  })

  test.for<[string, () => Promise<unknown>]>([
    ['cannot be loaded', async () => { throw new Error('no such model\nstack') }],
    ['returns too few vectors', async () => async () => ({ tolist: () => [] })],
    ['returns something that is not vectors', async () => async (texts: string[]) => ({ tolist: () => texts.map(() => ['x']) })],
    ['returns no list', async () => async () => ({ tolist: () => 'nothing' })],
  ])('a model that %s is "did not answer", and is loaded afresh the next time', async ([name, load]) => {
    let loads = 0
    const model = localModel(`proof/${name}`, (async () => { loads++; return load() }) as never)
    for (const _ of [1, 2])
      await expect(model.embed(['a'], 'document')).rejects.toMatchObject({ type: 'ServiceUnavailableError', message: 'Help did not answer. Try again in a minute.' })
    expect(loads).toBe(2)
  })
})
