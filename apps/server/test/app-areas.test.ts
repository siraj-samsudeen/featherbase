// #1282 G1–G6: an app declares the areas people pick on the trees (an axis of levels,
// each a Table linked to the one above), and the platform offers them to the area
// picker through the app catalog. Fixture: a copy of test-apps/fixtures/bar-proof.
import { afterEach, describe, expect } from 'vitest'
import { resolve } from 'node:path'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test } from './pg-test'
import { appCatalog, discoverPackages } from '../src/runtime-packages'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const LOCATION = {
  name: 'Location', whole: 'Whole company',
  levels: [
    { table: 'Cluster', title: 'name', label: 'Cluster', plural: 'clusters' },
    { table: 'Site', title: 'name', parent: 'cluster', label: 'Store', plural: 'stores', adminLabel: 'Site', adminPlural: 'sites', filters: [['is_store', '=', 1]] },
  ],
}

async function declaring(areas: unknown) {
  const directory = await mkdtemp(resolve('test/.areas-1282-'))
  directories.push(directory)
  await cp(BAR_PROOF, directory, { recursive: true })
  const file = resolve(directory, 'featherbase.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.areas = areas
  await writeFile(file, JSON.stringify(manifest))
  return directory
}

describe('an app declares its areas', () => {
  test('a level below the first must name its link to the level above', async () => {
    const broken = { ...LOCATION, levels: [LOCATION.levels[0], { ...LOCATION.levels[1], parent: undefined }] }
    expect(await discoverPackages([await declaring([broken])])).toEqual([
      expect.objectContaining({ error: "The app's area Location names Site under Cluster without the link to it" }),
    ])
  })

  test('the first level has nothing above it to link to', async () => {
    const broken = { ...LOCATION, levels: [{ ...LOCATION.levels[0], parent: 'region' }, LOCATION.levels[1]] }
    expect(await discoverPackages([await declaring([broken])])).toEqual([
      expect.objectContaining({ error: "The app's area Location starts at Cluster, which has no level above it to link to" }),
    ])
  })

  // The areas' Tables are the instance's: they are created here, as an instance has them.
  async function tables(admin: { post: (path: string, body: unknown) => Promise<unknown> }) {
    await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Cluster', id_pattern: 'prompt', title_column: 'name', columns: [{ column_name: 'name', column_type: 'Data' }] })
    await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Site', id_pattern: 'prompt', title_column: 'name', columns: [{ column_name: 'name', column_type: 'Data' },
      { column_name: 'cluster', column_type: 'Reference', reference_table: 'Cluster' }, { column_name: 'is_store', column_type: 'Check' }] })
  }

  test('the app catalog offers the declared areas to someone who may open the app', async ({ admin }) => {
    expect(await discoverPackages([await declaring([LOCATION])])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    await tables(admin)
    const entry = (await appCatalog(admin.user!)).find((e) => e.name === 'barproof') as { areas?: unknown } | undefined
    expect(entry?.areas).toEqual([LOCATION])
  })

  // Codex adversarial round 1: an area is offered only as the instance's Tables bear it out.
  const [cluster, site] = LOCATION.levels as [typeof LOCATION.levels[0], typeof LOCATION.levels[1]]
  test.for([
    ['no Table, no title column, no filter column', [
      { ...LOCATION, name: 'No Table', levels: [cluster, { ...site, table: 'Nowhere' }] },
      { ...LOCATION, name: 'No Title', levels: [{ ...cluster, title: 'nickname' }] },
      { ...LOCATION, name: 'No Filter Column', levels: [cluster, { ...site, filters: [['is_open', '=', 1]] }] }]],
    ['a parent that is no link, or links to another Table', [
      { ...LOCATION, name: 'Not A Link', levels: [cluster, { ...site, parent: 'is_store' }] },
      { ...LOCATION, name: 'Links Elsewhere', levels: [{ ...site, parent: undefined }, { ...site, parent: 'cluster' }] }]],
  ] as const)("an area the instance's Tables do not bear out is not offered: %s", async ([, broken], { admin }) => {
    expect(await discoverPackages([await declaring([LOCATION, ...broken])])).toEqual([])
    await admin.post('/api/install_app', { name: 'barproof' })
    await tables(admin)
    const entry = (await appCatalog(admin.user!)).find((e) => e.name === 'barproof') as { areas?: { name: string }[] } | undefined
    expect(entry?.areas?.map((a) => a.name)).toEqual(['Location'])
  })
})
