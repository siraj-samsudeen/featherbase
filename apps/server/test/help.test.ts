// Questions about how things work, answered from the help folder and the
// sources it lists: passages found by meaning, then an answer from the
// language model that names the passages it used. A made-up help folder is
// written to a temporary directory for each test; the embedding model and the
// language model are stand-ins.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { expectApiError } from './fixtures'
import { sql } from '../src/db'
import { overrideVariable } from '../src/env'
import { useEmbeddingModel, type EmbeddingModel } from '../src/help-embedding'
import { usePlanModel } from '../src/plan-model'
import { HELP_PASSAGES, MAX_PASSAGE, helpFiles, helpPrompt, readHelp, readHelpQuestion, readHelpReply, splitPassages, syncHelp } from '../src/help'

const RETURNS = `# Returns

Returns are taken at the service desk of the store where the goods were bought.

## How a refund is paid

A refund is paid to the card or account that paid. Cash sales are refunded in cash.

## When returns count

Returns are taken off sales on the day they are made, so a return can make a day's sales negative.

\`\`\`text
# not a heading: it is inside a code block
\`\`\`
`
const OPENING = '# Opening hours\n\nStores open at ten in the morning and close at ten at night, every day.\n'

let folder = ''
const write = (path: string, text: string) => {
  mkdirSync(resolve(folder, path, '..'), { recursive: true })
  writeFileSync(join(folder, path), text)
}
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'help-proof-'))
  write('help/sources.json', JSON.stringify({ include: ['.', '../extra/opening.md', '../nowhere'] }))
  write('help/guide/returns.md', RETURNS)
  write('help/guide/skip.txt', 'Not Markdown, so not read.')
  write('help/.hidden/secret.md', '# Secret\n\nA hidden folder is never read, whatever is in it.')
  write('extra/opening.md', OPENING)
  write('extra/unlisted.md', '# Unlisted\n\nNot in the list, so never read.')
  overrideVariable('HELP_SOURCES', join(folder, 'help/sources.json'))
})
afterEach(() => {
  overrideVariable('HELP_SOURCES', undefined)
  useEmbeddingModel(undefined)
  usePlanModel(undefined)
  rmSync(folder, { recursive: true, force: true })
})

// A stand-in for meaning: each word counts in one of 256 places, and the vector has length 1.
const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? []
function vectorOf(text: string): number[] {
  const vector = Array.from({ length: 256 }, () => 0)
  for (const word of words(text)) vector[[...word].reduce((hash, letter) => (hash * 31 + letter.charCodeAt(0)) % 256, 7)] += 1
  const length = Math.hypot(...vector) || 1
  return vector.map(value => value / length)
}
function standIn(name = 'stand-in') {
  const calls: { texts: readonly string[]; kind: string }[] = []
  const model: EmbeddingModel = { name, async embed(texts, kind) { calls.push({ texts, kind }); return texts.map(vectorOf) } }
  useEmbeddingModel(model)
  return calls
}
function language(reply: string) {
  const asked: { system: string; question: string }[] = []
  usePlanModel({ async complete(prompt) { asked.push(prompt); return reply } })
  return asked
}
const ask = (question: unknown) => ({ payload: { question } })

describe('the help sources', () => {
  test('are the Markdown files the list names, by their path from the folder above the list, hidden folders and other files left out', () => {
    expect(helpFiles().map(file => file.source)).toEqual(['extra/opening.md', 'help/guide/returns.md'])
  })

  test('a list that is missing or malformed is "not set up"', () => {
    overrideVariable('HELP_SOURCES', join(folder, 'help/none.json'))
    expect(() => readHelp()).toThrow(/Help is not set up on this instance: .*none\.json is missing/)
    write('help/bad.json', '{"include": []}')
    overrideVariable('HELP_SOURCES', join(folder, 'help/bad.json'))
    expect(() => readHelp()).toThrow('must be { "include": [<paths>] }')
  })

  test('the repository\'s own help folder is searched, with the Dash README, the specs and the docs', () => {
    overrideVariable('HELP_SOURCES', undefined)
    const sources = new Set(readHelp().map(passage => passage.source))
    for (const source of ['help/dash/asking-about-your-figures.md', 'help/dash/what-the-figures-mean.md',
      'help/dash/whose-figures-you-see.md', 'client-apps/jeyarama/dash/README.md', 'docs/DEPLOY.md'])
      expect(sources).toContain(source)
    expect([...sources].some(source => source.startsWith('openspec/specs/'))).toBe(true)
    expect(readHelp().every(passage => passage.body.length <= MAX_PASSAGE)).toBe(true)
  })
})

describe('a source split into passages', () => {
  test('each heading\'s text is a passage, under the path of headings above it; a "#" in a code block is no heading', () => {
    expect(splitPassages('help/guide/returns.md', RETURNS)).toEqual([
      { source: 'help/guide/returns.md', heading: 'Returns', body: 'Returns are taken at the service desk of the store where the goods were bought.' },
      { source: 'help/guide/returns.md', heading: 'Returns › How a refund is paid', body: 'A refund is paid to the card or account that paid. Cash sales are refunded in cash.' },
      { source: 'help/guide/returns.md', heading: 'Returns › When returns count',
        body: "Returns are taken off sales on the day they are made, so a return can make a day's sales negative.\n\n```text\n# not a heading: it is inside a code block\n```" }])
  })

  test('a file with no title is called by its name; a deeper heading keeps the ones above it, a shallower one drops them', () => {
    const text = 'Text before any heading, long enough to keep.\r\n## One\r\n### Two\r\nUnder one, then two: kept here.\r\n## Three\r\nUnder three alone, kept here too.\r\n## Bare ##\r\nok'
    expect(splitPassages('docs/notes.md', text).map(({ heading, body }) => [heading, body])).toEqual([
      ['notes', 'Text before any heading, long enough to keep.'], ['notes › One › Two', 'Under one, then two: kept here.'], ['notes › Three', 'Under three alone, kept here too.']])
  })

  test('a long passage is cut at its paragraphs, and a long paragraph at the limit', () => {
    const paragraph = (letter: string, length: number) => letter.repeat(length)
    const text = `# Long\n\n${paragraph('a', 1000)}\n\n${paragraph('b', 1000)}\n\n${paragraph('c', 4000)}`
    expect(splitPassages('long.md', text).map(passage => [passage.body.length, passage.body[0]])).toEqual([
      [1000, 'a'], [1000, 'b'], [MAX_PASSAGE, 'c'], [MAX_PASSAGE, 'c'], [400, 'c']])
  })
})

describe('the passages kept with their embeddings', () => {
  test('are embedded once; a changed passage is embedded again and one no longer there is removed', async () => {
    const calls = standIn()
    expect(await syncHelp(readHelp())).toEqual({ embedded: 4, removed: 0 })
    expect(calls[0]).toMatchObject({ kind: 'document', texts: expect.arrayContaining(['Returns › How a refund is paid\n\nA refund is paid to the card or account that paid. Cash sales are refunded in cash.']) })
    expect(await syncHelp(readHelp())).toEqual({ embedded: 0, removed: 0 })
    write('help/guide/returns.md', RETURNS.replace('Cash sales are refunded in cash.', 'Cash sales are refunded by bank transfer.'))
    write('extra/opening.md', '# Opening hours\n\nok')
    expect(await syncHelp(readHelp())).toEqual({ embedded: 1, removed: 2 })
    expect((await sql`select heading from help_passage order by heading`).map(row => row.heading)).toEqual(['Returns', 'Returns › How a refund is paid', 'Returns › When returns count'])
  })

  test('another embedding model embeds every passage again, and the old model\'s are removed', async () => {
    standIn('first')
    await syncHelp(readHelp())
    standIn('second')
    expect(await syncHelp(readHelp())).toEqual({ embedded: 4, removed: 4 })
    expect(await sql`select distinct model from help_passage`).toEqual([{ model: 'second' }])
  })
})

describe('asking the help', () => {
  test('the passages nearest the question are given to the language model, and the answer names those it used', async ({ admin }) => {
    const calls = standIn()
    const asked = language('```json\n{"answer": "It goes back to the card that paid.", "sources": [1, 1]}\n```')
    const answer = await admin.post('/api/help/ask', ask('  How is a refund paid?  '))
    expect(answer).toEqual({ question: 'How is a refund paid?', answer: 'It goes back to the card that paid.',
      sources: [{ source: 'help/guide/returns.md', heading: 'Returns › How a refund is paid' }] })
    expect(calls.at(-1)).toEqual({ texts: ['How is a refund paid?'], kind: 'query' })
    expect(asked[0].question).toBe('How is a refund paid?')
    expect(asked[0].system).toContain('[1] help/guide/returns.md — Returns › How a refund is paid\nA refund is paid to the card or account that paid.')
    expect(asked[0].system).toContain('[4] ')
    expect(asked[0].system).not.toContain('Unlisted')
  })

  test('a question the help does not cover says so in plain words', async ({ admin }) => {
    standIn()
    language('{"cannot": "The help does not cover parking."}')
    await expectApiError(admin.post('/api/help/ask', ask('Where do I park?')), { status: 417, message: expect.stringContaining('The help does not answer that: The help does not cover parking.') })
  })

  test.for(['no JSON', '{"answer": "Yes."}', '{"answer": "Yes.", "sources": []}', '{"answer": "Yes.", "sources": [9]}', '{"answer": "Yes.", "sources": [1], "sql": "x"}'])(
    'a reply of %j is refused, never repaired', async (reply, { admin }) => {
      standIn()
      language(reply)
      await expectApiError(admin.post('/api/help/ask', ask('How is a refund paid?')), { status: 417, message: expect.stringContaining('That question could not be answered from the help. Try asking it another way.') })
    })

  test.for([['an empty question', '   '], ['an overlong question', 'x'.repeat(501)], ['no question', 3]])('%s is refused before anything is embedded', async ([, question], { admin }) => {
    const calls = standIn()
    await expectApiError(admin.post('/api/help/ask', ask(question)), { status: 417, message: expect.stringContaining('Expected { payload: { question } }') })
    expect(calls).toEqual([])
  })

  test('sources that hold no passage are "not set up"', async ({ admin }) => {
    standIn()
    language('{}')
    write('help/sources.json', JSON.stringify({ include: ['../nowhere'] }))
    await expectApiError(admin.post('/api/help/ask', ask('Anything?')), { status: 409, message: expect.stringContaining('its sources hold no passages') })
  })

  test('the prompt and the reply', () => {
    const prompt = helpPrompt([{ source: 'a.md', heading: 'A', body: 'Alpha.' }, { source: 'b.md', heading: 'B › C', body: 'Beta.' }])
    expect(prompt).toContain('Answer only from the numbered passages below.')
    expect(prompt.endsWith('[1] a.md — A\nAlpha.\n\n[2] b.md — B › C\nBeta.')).toBe(true)
    expect(readHelpReply('{"answer": " Yes. ", "sources": [2, 1, 2]}', 2)).toEqual({ answer: 'Yes.', sources: [2, 1] })
    expect(readHelpQuestion({ payload: { question: ' Why? ' } })).toBe('Why?')
    expect(HELP_PASSAGES).toBe(6)
  })
})
