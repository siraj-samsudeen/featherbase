// #1236: an app says what it is for, in one line, and names its icon, in its
// manifest; the app catalog hands both to the app switcher, with the app's
// accent. Anything else is refused when the app is found.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { discoverPackages } from '../src/runtime-packages'
import { admitTasker } from './tasker-client'
import { test } from './pg-test'

const TASKER = resolve('../..', 'example-apps/tasker')

/** Tasker, copied, with its manifest changed by `change`; what finding it says. */
async function findChanged(change: (manifest: Record<string, unknown>) => Record<string, unknown>) {
  const copy = await mkdtemp(resolve('test/.catalog-summary-'))
  try {
    await cp(TASKER, copy, { recursive: true, filter: (source) => !source.includes('node_modules') })
    const manifest = JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8'))
    await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify(change(manifest)))
    return JSON.stringify(await discoverPackages([copy]))
  } finally {
    await rm(copy, { recursive: true, force: true })
    await discoverPackages([])
  }
}

describe('#1236: what an app is for, in the app catalog', () => {
  test('the catalog gives each app its one line, its icon and its accent', async ({ admin }) => {
    expect(await discoverPackages([TASKER])).toEqual([])
    await admin.post('/api/install_app', { name: 'tasker' })
    await admitTasker(admin)
    const catalog = await admin.get<{ name: string; summary?: string; icon?: string; accent?: string }[]>('/api/app_catalog')
    const manifest = JSON.parse(await readFile(resolve(TASKER, 'featherbase.json'), 'utf8'))
    expect(catalog.find((app) => app.name === 'tasker')).toMatchObject({
      summary: 'Tasks and store work, with what is due', icon: 'checklist',
      ...(manifest.accent ? { accent: manifest.accent } : {}),
    })
    await discoverPackages([])
  })

  test('an icon outside the set is refused when the app is found', async () => {
    expect(await findChanged((manifest) => ({ ...manifest, icon: 'rocket' }))).toMatch(/icon/)
  })

  test('a summary longer than one line is refused when the app is found', async () => {
    expect(await findChanged((manifest) => ({ ...manifest, summary: 'x'.repeat(81) }))).toMatch(/summary/)
  })

  test('an app may say neither', async () => {
    expect(await findChanged(({ summary: _s, icon: _i, ...manifest }) => manifest)).toBe('[]')
  })
})

describe("#1237: an app's own page for one of its rows", () => {
  test('the catalog gives it, for the record page to open', async ({ admin }) => {
    const copy = await mkdtemp(resolve('test/.catalog-record-pages-'))
    try {
      await cp(TASKER, copy, { recursive: true, filter: (source) => !source.includes('node_modules') })
      const manifest = JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8'))
      await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify({ ...manifest, recordPages: { 'tasker.task': '/tasker/?task={row}' } }))
      expect(await discoverPackages([copy])).toEqual([])
      await admin.post('/api/install_app', { name: 'tasker' })
      await admitTasker(admin)
      const catalog = await admin.get<{ name: string; recordPages?: Record<string, string> }[]>('/api/app_catalog')
      expect(catalog.find((app) => app.name === 'tasker')?.recordPages).toEqual({ 'tasker.task': '/tasker/?task={row}' })
    } finally {
      await rm(copy, { recursive: true, force: true })
      await discoverPackages([])
    }
  })

  test("a page for a Table that is not the app's own is refused", async () => {
    expect(await findChanged((manifest) => ({ ...manifest, recordPages: { Person: '/tasker/?person={row}' } }))).toMatch(/not one of the app's/)
  })

  test("a page outside the app's own address is refused", async () => {
    expect(await findChanged((manifest) => ({ ...manifest, recordPages: { 'tasker.task': '/dash/?task={row}' } }))).toMatch(/not one of the app's own pages/)
  })

  test('a page with no place for the row is refused', async () => {
    expect(await findChanged((manifest) => ({ ...manifest, recordPages: { 'tasker.task': '/tasker/' } }))).toMatch(/\{row\}/)
  })
})

describe('#1236 (option A): who an installed app opens for, on the Apps page', () => {
  test("an installed app's entry names the roles that open it; an app not installed names none", async ({ admin }) => {
    expect(await discoverPackages([TASKER])).toEqual([])
    await admin.post('/api/install_app', { name: 'tasker' })
    const { catalog } = await admin.get<{ catalog: { name: string; installed: boolean; opensFor?: unknown }[] }>('/api/apps')
    expect(catalog.find((app) => app.name === 'tasker')).toMatchObject({ installed: true, opensFor: { everyone: false, roles: ['Tasker Member'], gated: false } })
    for (const app of catalog.filter((entry) => !entry.installed)) expect(app.opensFor).toBeUndefined()
    await discoverPackages([])
  })
})

describe('#1236, Codex review round 11: no mandatory policy is no ceiling, not no access', () => {
  test('an app whose entry Table every role reads opens for everyone', async ({ admin }) => {
    const TICKETS = resolve('../..', 'example-apps/tickets')
    expect(await discoverPackages([TICKETS])).toEqual([])
    await admin.post('/api/install_app', { name: 'tickets' })
    const { catalog } = await admin.get<{ catalog: { name: string; opensFor?: unknown }[] }>('/api/apps')
    expect(catalog.find((app) => app.name === 'tickets')?.opensFor).toMatchObject({ everyone: true, roles: [], gated: false })
    await discoverPackages([])
  })
})

describe('#1236, Codex review round 12: a grant and a mandatory policy are separate requirements', () => {
  test('the summary keeps the roles granted read apart from the roles the policy admits', async ({ admin }) => {
    expect(await discoverPackages([TASKER])).toEqual([])
    await admin.post('/api/install_app', { name: 'tasker' })
    const { catalog } = await admin.get<{ catalog: { name: string; opensFor?: { roles: string[]; admits?: string[] } }[] }>('/api/apps')
    const opensFor = catalog.find((app) => app.name === 'tasker')?.opensFor
    // Never an intersection: the granted roles are listed whatever the policy admits.
    expect(opensFor?.roles).toEqual(['Tasker Member'])
    if (opensFor?.admits) expect(Array.isArray(opensFor.admits)).toBe(true)
    await discoverPackages([])
  })
})
