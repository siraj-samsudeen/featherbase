// #1340: an installed app that describes rows of its Table for Featherbase's own list and record page, and previews
// one of its actions. A copy of test-apps/fixtures/bar-proof with notes, their lines (a link group), tags joined to notes
// (a tick list), a `records` declaration and a preview. What the app answers is `hook()`'s; tests change it.
import { afterEach, expect } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { discoverPackages } from 'server/src/runtime-packages'
import type { renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
export const NOTE = 'barproof.note'
export const LINE = 'barproof.line'
export const TAG = 'barproof.tag'
export const NOTE_TAG = 'barproof.note_tag'
const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const tableRead = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }

type Hook = { facts?: unknown; preview?: unknown; refuse?: boolean; runs: number; runFails?: boolean; done?: unknown }
export const hook = (): Hook => ((globalThis as unknown as { __facts1340?: Hook }).__facts1340 ??= { runs: 0 })
const directories: string[] = []
afterEach(async () => {
  const h = hook()
  delete h.facts; delete h.preview; delete h.refuse; delete h.runFails; delete h.done
  h.runs = 0
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** Twelve people, of whom the app sends eleven and says there are fifteen. */
const people = Array.from({ length: 11 }, (_, i) => ({ parts: [`Person ${i + 1}`], chip: { label: i ? 'from HR' : 'given by hand', tone: i ? 'quiet' : 'caution' } }))

export function factsFor(rows: string[], page: boolean) {
  return {
    version: 1,
    columns: [{ key: 'people', label: 'People' }, { key: 'state', label: 'State' }, { key: 'kind', label: 'Kind' }, { key: 'missing', label: 'Missing' }],
    rows: Object.fromEntries(rows.map((row) => [row, {
      facts: { people: { text: '15' }, state: { text: 'Live', tone: 'positive' }, kind: { text: 'Plain', tone: 'quiet' } },
      header: 'Note · 15 people · from HR and by hand',
      ...(page ? { groups: [
        { key: 'lines', heading: 'What It Says', table: LINE, links: [{ label: 'Open as grid', href: '/featherbase/admin/table/barproof.line' }],
          rows: { l1: { parts: ['The first line says ', { record: { table: NOTE, row: row, name: 'this note' } }, ' ', { chip: 'Area' }], note: ['In the note'] } } },
        { key: 'tags', heading: 'Tags It Has', table: NOTE_TAG, removedColumn: 'removed', tickFields: [], count: 1, notes: { t1: 'Also on two other notes', t2: 'On no other note' } },
        { key: 'people', heading: 'People', count: 15, lines: people, all: { label: 'Open as list', href: '/featherbase/admin/table/Person' } },
        { key: 'empty', heading: 'Nobody Yet', count: 0, lines: [] },
      ] } : {}),
    }])),
    actions: [
      { key: 'tidy', label: 'Tidy The Notes', explain: 'Tidies every note. Running it again changes nothing.', run: 'tidy' },
      { key: 'preview', label: 'Tidy With A Preview…', explain: 'Shows what it would tidy first.', href: `/featherbase/admin/table/${NOTE}/run/tidy` },
      { key: 'away', label: 'The App Page', explain: 'Opens the app.', href: '/barproof/' },
    ],
  }
}

export const PREVIEW = {
  version: 1, title: 'Tidy The Notes', status: 'Preview · nothing is saved until Run', sentence: ['Tidies ', { record: { table: NOTE, row: 'n1', name: 'the note' } }, '.'],
  runLabel: 'Run', filters: [{ key: 'add', label: 'Will be added' }, { key: 'there', label: 'Already there' }],
  columns: [{ key: 'what', label: 'What' }, { key: 'happens', label: 'What Happens', nowrap: true }, { key: 'blank', label: 'Blank' }],
  rows: [
    { filter: 'add', cells: { what: { parts: [{ record: { table: NOTE, row: 'n1', name: 'Kept' } }] }, happens: { text: 'Will be added', tone: 'neutral' } } },
    { filter: 'there', cells: { what: { parts: ['Second'] }, happens: { text: 'Already there', tone: 'quiet' } } },
  ],
  note: 'Running this again adds nothing.',
}

export async function installFacts(admin: Client) {
  const directory = await mkdtemp(resolve('test/.facts-1340-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.tables[0].title_column = 'body'
  manifest.tables.push(
    { name: LINE, label: 'line', id_pattern: 'prompt', title_column: 'words', columns: [{ column_name: 'words', column_type: 'Data' }, { column_name: 'note', column_type: 'Reference', reference_table: NOTE }] },
    { name: TAG, label: 'tag', id_pattern: 'prompt', title_column: 'title', columns: [{ column_name: 'title', column_type: 'Data' }] },
    { name: NOTE_TAG, label: 'note tag', columns: [{ column_name: 'note', column_type: 'Reference', reference_table: NOTE }, { column_name: 'tag', column_type: 'Reference', reference_table: TAG }, { column_name: 'line', column_type: 'Reference', reference_table: LINE }, { column_name: 'removed', column_type: 'Check' }] },
  )
  manifest.reads.tables = [NOTE, LINE, TAG, NOTE_TAG]
  manifest.reads.operations = { ...manifest.reads.operations, describe_notes: tableRead, preview_tidy: tableRead }
  manifest.actions = { version: 2, tables: [NOTE], operations: { tidy: tableRead } }
  manifest.records = { [NOTE]: { describe: 'describe_notes', previews: { tidy: 'preview_tidy' } } }
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
const facts = (globalThis.__facts1340 ??= { runs: 0 })
const answer = ${factsFor.toString()}
const people = ${JSON.stringify(people)}
const NOTE = '${NOTE}', LINE = '${LINE}', NOTE_TAG = '${NOTE_TAG}'
reads.describe_notes = ({ payload }) => { if (facts.refuse) throw new Error('Not for you'); return facts.facts ?? answer(payload.rows, payload.page) }
reads.preview_tidy = () => facts.preview ?? ${JSON.stringify(PREVIEW)}
export const actions = { tidy: (context) => { if (facts.runFails) context.reject('The notes are busy'); facts.runs++; return facts.done ?? { tidied: true } } }
`)
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'n1', body: 'Kept' } })
  await admin.post('/api/save_row', { table: LINE, row: { row_id: 'l1', words: 'First', note: 'n1' } })
  await admin.post('/api/save_row', { table: LINE, row: { row_id: 'l2', words: 'Second', note: 'n1' } })
  await admin.post('/api/save_row', { table: TAG, row: { row_id: 't1', title: 'Urgent' } })
  await admin.post('/api/save_row', { table: TAG, row: { row_id: 't2', title: 'Later' } })
  await admin.post('/api/save_row', { table: NOTE_TAG, row: { note: 'n1', tag: 't1' } })
}
