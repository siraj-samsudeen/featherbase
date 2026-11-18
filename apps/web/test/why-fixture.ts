// #1282 Why mode: an installed app that explains a record on the Map. A copy of
// test-apps/fixtures/bar-proof with a `why` for its notes; its explanation is
// whatever `hook().answer` holds (ACCESS by default), and `hook().may = false`
// makes the app refuse. Used by why-map.test.tsx and the relational-navigation scenarios.
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect } from 'vitest'
import { resolve } from 'node:path'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tableHref } from 'shared'
import { discoverPackages } from 'server/src/runtime-packages'
import { renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
export const NOTE = 'barproof.note'
const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const tableRead = { policy: { kind: 'table' }, authorization: { kind: 'generic' } }

const directories: string[] = []
export const hook = () => ((globalThis as unknown as { __why1282?: { answer: unknown; asked: unknown[]; may?: boolean } }).__why1282 ??= { answer: null, asked: [] })
afterEach(async () => {
  hook().answer = null
  delete hook().may
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** A floor manager's access, as an app would explain it. */
export const ACCESS = {
  version: 1,
  columns: [
    { heading: 'Person', boxes: [{ id: 'p', name: 'The note', record: { table: NOTE, row: 'n1' } }] },
    { heading: 'Business Role · Area', boxes: [
      { id: 'fm', name: 'Floor Manager', detail: 'Store C · First floor', source: 'hr' },
      { id: 'buyer', name: 'Buyer', detail: 'Kids Ethnic', source: 'hand' },
    ] },
    { heading: 'App · Level', boxes: [{ id: 'dash', name: 'Dash · Reader' }, { id: 'tasker', name: 'Tasker · Manager' }] },
    { heading: 'What They Can Do', boxes: [{ id: 'view', name: 'View reports', reach: 'Area' }, { id: 'hidden', name: 'Secret', record: { table: 'Person', row: 'psn_nobody_anyone_may_read' } }] },
  ],
  edges: [['p', 'fm'], ['p', 'buyer'], ['fm', 'dash'], ['buyer', 'dash'], ['fm', 'tasker'], ['dash', 'view']],
}

export async function installWhy(admin: Client, label?: string) {
  const directory = await mkdtemp(resolve('test/.why-1282-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.roles = ['Bar Reader', 'Bar Explainer']
  manifest.reads.operations = { ...manifest.reads.operations, may_explain: tableRead, explain: tableRead }
  manifest.why = { [NOTE]: { explain: 'explain', may: 'may_explain', ...(label ? { label } : {}) } }
  await writeFile(file, JSON.stringify(manifest))
  await appendFile(resolve(directory, 'server.mjs'), `
const why = (globalThis.__why1282 ??= { answer: null, asked: [] })
reads.may_explain = ({ roles }) => why.may !== false && (roles.includes('Bar Explainer') || roles.includes('System Manager'))
reads.explain = () => why.answer
`)
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  await admin.post('/api/save_row', { table: NOTE, row: { row_id: 'n1', body: 'kept' } })
  hook().answer = ACCESS
}

export async function openWhyRecordMap(client: Client) {
  const view = await renderApp(`${tableHref(NOTE)}/row/n1`, client)
  fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
  await screen.findByTestId('relation-map')
  return view
}

