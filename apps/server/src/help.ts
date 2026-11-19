// Questions about how things work, answered from the help folder (help/) and
// the sources it lists (help/sources.json), as Cortex Search answers from a
// company's documents. The passages are embedded once and kept in
// help_passage; a question is embedded too, and the passages nearest to it in
// meaning are given to the language model, which answers from them alone and
// says which it used. The answer names those files under it.
//
// Before each question the sources are read again and only passages that are
// new or changed are embedded, so editing a page is enough to change answers.
// No person's figures are involved: help is the same for everyone signed in.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { readVariable } from './env'
import { embeddingModel } from './help-embedding'
import { planModel } from './plan-model'

/** A searchable part of a source: the text under one heading. */
export interface Passage { source: string; heading: string; body: string }

/** A passage longer than this is split at its paragraphs; a paragraph longer than this, at this length. */
export const MAX_PASSAGE = 1800
/** A heading with less text than this under it is no passage. */
const MIN_BODY = 20
/** How many passages the language model is given to answer from. */
export const HELP_PASSAGES = 6
export const MAX_HELP_QUESTION = 500

/** The list of sources: HELP_SOURCES, or this repository's help/sources.json. */
export function helpSourcesFile(): string {
  return readVariable('HELP_SOURCES')?.trim() || resolve(import.meta.dirname, '../../../help/sources.json')
}

const notSetUp = (why: string) => new AppError('NotSetUpError', `Help is not set up on this instance: ${why}`)

/**
 * The Markdown files the list names, each with its name as answers show it:
 * its path from the folder above the list's own folder, so the repository's
 * help/sources.json names help/…, docs/… and openspec/….
 */
export function helpFiles(file = helpSourcesFile()): { source: string; path: string }[] {
  if (!existsSync(file)) throw notSetUp(`${file} is missing`)
  let include: string[]
  try {
    include = z.object({ include: z.array(z.string().min(1)).min(1) }).parse(JSON.parse(readFileSync(file, 'utf8'))).include
  } catch {
    throw notSetUp(`${file} must be { "include": [<paths>] }`)
  }
  const base = dirname(file)
  const root = dirname(base)
  const found = new Map<string, string>()
  const visit = (path: string) => {
    const stat = statSync(path)
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort())
        if (!name.startsWith('.') && name !== 'node_modules') visit(join(path, name))
    } else if (stat.isFile() && extname(path).toLowerCase() === '.md') found.set(relative(root, path).split(sep).join('/'), path)
  }
  for (const entry of include) {
    const path = resolve(base, entry)
    if (existsSync(path)) visit(path)
    else console.warn(`[help] ${entry} in ${file} does not exist; it is skipped`)
  }
  return [...found].sort(([a], [b]) => a < b ? -1 : 1).map(([source, path]) => ({ source, path }))
}

/**
 * Splits a Markdown file at its headings. A passage's heading is the path of
 * headings above it ("Title › Section"); the text before the first heading is
 * under the title. A long passage is split at its paragraphs. A "#" inside a
 * fenced code block is not a heading.
 */
export function splitPassages(source: string, text: string): Passage[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const fallback = source.split('/').pop()!.replace(/\.md$/i, '')
  const title = lines.find(line => /^# \S/.test(line))?.slice(2).trim() || fallback
  const stack: { level: number; text: string }[] = []
  const passages: Passage[] = []
  let body: string[] = []
  let fenced = false
  const flush = () => {
    const heading = [title, ...stack.filter(({ level, text }) => !(level === 1 && text === title)).map(entry => entry.text)].join(' › ')
    const kept = body.join('\n').trim()
    body = []
    if (kept.length < MIN_BODY) return
    for (const piece of pieces(kept)) passages.push({ source, heading, body: piece })
  }
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!heading) { body.push(line); continue }
    flush()
    const level = heading[1].length
    while (stack.length && stack.at(-1)!.level >= level) stack.pop()
    stack.push({ level, text: heading[2] })
  }
  flush()
  return passages
}

// A long text, cut at blank lines into pieces no longer than MAX_PASSAGE.
function pieces(text: string): string[] {
  if (text.length <= MAX_PASSAGE) return [text]
  const out: string[] = []
  let current = ''
  for (const paragraph of text.split(/\n\s*\n/)) {
    for (let at = 0; at < paragraph.length; at += MAX_PASSAGE) {
      const part = paragraph.slice(at, at + MAX_PASSAGE).trim()
      if (!part) continue
      if (current && current.length + part.length + 2 > MAX_PASSAGE) { out.push(current); current = '' }
      current = current ? `${current}\n\n${part}` : part
    }
  }
  if (current) out.push(current)
  return out
}

/** Every passage of every listed source. */
export function readHelp(file = helpSourcesFile()): Passage[] {
  return helpFiles(file).flatMap(({ source, path }) => splitPassages(source, readFileSync(path, 'utf8')))
}

const hashOf = ({ source, heading, body }: Passage) => createHash('sha256').update(`${source}\0${heading}\0${body}`).digest('hex')
// What is embedded for a passage: where it is, then what it says.
const documentText = ({ heading, body }: Passage) => `${heading}\n\n${body}`

/**
 * Brings help_passage in line with the sources: embeds the passages that are
 * new or changed, removes those no longer there and those embedded by another
 * model. Returns how many were embedded and removed.
 */
export async function syncHelp(passages: readonly Passage[]): Promise<{ embedded: number; removed: number }> {
  const model = embeddingModel()
  const current = new Map(passages.map(passage => [hashOf(passage), passage]))
  const kept = new Set((await sql<{ content_hash: string }[]>`select content_hash from help_passage where model = ${model.name}`).map(row => row.content_hash))
  const fresh = [...current].filter(([hash]) => !kept.has(hash))
  if (fresh.length) {
    const vectors = await model.embed(fresh.map(([, passage]) => documentText(passage)), 'document')
    for (const [index, [hash, passage]] of fresh.entries())
      await sql`insert into help_passage (source, heading, body, content_hash, model, embedding)
        values (${passage.source}, ${passage.heading}, ${passage.body}, ${hash}, ${model.name}, ${vectors[index]}::real[])
        on conflict (content_hash, model) do nothing`
  }
  const removed = await sql`delete from help_passage where model <> ${model.name} or not (content_hash = any(${[...current.keys()]}::text[]))`
  return { embedded: fresh.length, removed: removed.count }
}

/** The passages nearest to the question in meaning, nearest first, each with its score (1 is the same meaning). */
export async function searchHelp(question: string, count = HELP_PASSAGES): Promise<(Passage & { score: number })[]> {
  const passages = readHelp()
  if (!passages.length) throw notSetUp('its sources hold no passages')
  await syncHelp(passages)
  const model = embeddingModel()
  const [asked] = await model.embed([question], 'query')
  const rows = await sql<{ source: string; heading: string; body: string; embedding: number[] }[]>`
    select source, heading, body, embedding from help_passage where model = ${model.name}`
  // The vectors have length 1, so their dot product is how near they are in meaning.
  const dot = (vector: readonly unknown[]) => vector.reduce<number>((sum, value, index) => sum + Number(value) * (asked[index] ?? 0), 0)
  return rows.map(({ source, heading, body, embedding }) => ({ source, heading, body, score: dot(embedding) }))
    .sort((a, b) => b.score - a.score || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)).slice(0, count)
}

/** The system prompt: the numbered passages, and how to answer from them. */
export function helpPrompt(passages: readonly Passage[]): string {
  return [
    'You answer questions about how Featherbase and its apps work, for the people who use them.',
    'Answer only from the numbered passages below. Do not use anything else you know, and never make up a figure, a name or a step.',
    'You never see anyone\'s data: for a question about their own figures, say they can ask about their figures in the chat's Agent mode.',
    'Write in plain words for a store manager, in at most 150 words. Do not mention passages, numbers in brackets, files or code.',
    '',
    'Reply with one JSON object and nothing else: {"answer": "<the answer>", "sources": [<the numbers of the passages the answer uses>]},',
    'or, when the passages do not answer the question, {"cannot": "<one short sentence saying what the help does not cover>"}.',
    '',
    ...passages.flatMap((passage, index) => [`[${index + 1}] ${passage.source} — ${passage.heading}`, passage.body, '']),
  ].join('\n').trimEnd()
}

const sentence = z.string().trim().min(1).max(300)
const reply = z.union([z.object({ answer: z.string().trim().min(1).max(3000), sources: z.array(z.number().int()).min(1) }).strict(), z.object({ cannot: sentence }).strict()])

/** Reads the language model's reply: an answer and the passages it used. One that is not, or names a passage it was not given, is refused, never repaired. */
export function readHelpReply(text: string, given: number): { answer: string; sources: number[] } {
  let parsed: z.infer<typeof reply> | undefined
  try { parsed = reply.parse(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))) } catch { parsed = undefined }
  if (parsed && 'cannot' in parsed) throw new AppError('ValidationError', `The help does not answer that: ${parsed.cannot}`)
  if (!parsed || !parsed.sources.every(number => number >= 1 && number <= given))
    throw new AppError('ValidationError', 'That question could not be answered from the help. Try asking it another way.')
  return { answer: parsed.answer, sources: [...new Set(parsed.sources)] }
}

/** Reads a request's question, refusing an empty or overlong one. */
export function readHelpQuestion(input: unknown): string {
  const parsed = z.object({ payload: z.object({ question: z.string().trim().min(1).max(MAX_HELP_QUESTION) }).strict() }).strict().safeParse(input)
  if (!parsed.success) throw new AppError('ValidationError', `Expected { payload: { question } }, a question of 1 to ${MAX_HELP_QUESTION} characters`)
  return parsed.data.payload.question
}

/** Answers a question about how things work from the help, naming the sources it used, in the order the answer used them. */
export async function answerHelp(input: unknown) {
  const question = readHelpQuestion(input)
  const language = planModel()
  const passages = await searchHelp(question)
  const { answer, sources } = readHelpReply(await language.complete({ system: helpPrompt(passages), question }), passages.length)
  return { question, answer, sources: sources.map(number => ({ source: passages[number - 1].source, heading: passages[number - 1].heading })) }
}
