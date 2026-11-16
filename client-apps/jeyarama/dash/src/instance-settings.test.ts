// Every deploy applies instance-settings.json, so a Table Dash reads that the file does not list stays
// unlisted on the instance, and the page that needs it says Dash is not set up (#1205: the department
// load failed every store on production for this). Each environment must list every Table Dash reads.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEPARTMENT_TABLES, isSetUp } from './department-setup.ts'
import { BASE_TABLES } from './my-sections.ts'

const file = JSON.parse(readFileSync(new URL('../../instances/dash/instance-settings.json', import.meta.url), 'utf8')) as {
  environments: Record<string, { settings: { 'App Setting'?: { row_id: string; value: string }[] } }> }
const manifest = JSON.parse(readFileSync(new URL('../featherbase.json', import.meta.url), 'utf8')) as { baseTables: { read: Record<string, unknown>; propose: Record<string, unknown> } }

// The hosted ones: a developer's machine gets its list from the made-up seed.
const hosted = Object.keys(file.environments).filter(name => file.environments[name].settings['App Setting'])

it('covers the hosted environments', () => expect(hosted).toEqual(['dev', 'prod']))

describe.each(hosted)('the %s settings', environment => {
  const listed = JSON.parse(file.environments[environment].settings['App Setting']!.find(row => row.row_id === 'dash.linked_tables')!.value) as string[]

  it('set up Your sections and departments', () => {
    expect(listed).toEqual(expect.arrayContaining([...BASE_TABLES, ...DEPARTMENT_TABLES]))
    expect(isSetUp({ settings: { linked_tables: JSON.stringify(listed) } } as never)).toBe(true)
  })

  it('list every core Table the manifest reads or proposes to', () => {
    // Dash's own Tables (dash.*) are its own, never linked.
    const core = [...Object.keys(manifest.baseTables.read), ...Object.keys(manifest.baseTables.propose)].filter(name => !name.startsWith('dash.'))
    expect(listed).toEqual(expect.arrayContaining(core))
  })
})
