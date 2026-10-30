// Siraj's wording rule: what a person reads says "subcategory", never SAP's
// name for it; identifiers such as `material_group_code` stay as they are.
// (The phrase is built from its words so this file never reads as a hit.)
const SAP_NAME = new RegExp(['material', 'group'].join(' '), 'i')
import { describe, expect, it } from 'vitest'
import manifest from '../featherbase.json' with { type: 'json' }

const PROSE_WITHOUT_IDENTIFIERS = (text: string) => text.replace(/`[^`]*`|\([a-z_]+\)|\b[a-z]+(?:_[a-z]+)+\b/g, '')

describe('the column descriptions people read', () => {
  const columns = manifest.tables.flatMap(t => t.columns.map(c => ({ table: t.name, ...c })))

  it.each(columns.filter(c => 'description' in c && c.description).map(c => [`${c.table}.${c.column_name}`, c.description as string]))(
    "%s never uses SAP's name for the subcategory outside an identifier", (_name, description) => {
      expect(PROSE_WITHOUT_IDENTIFIERS(description)).not.toMatch(SAP_NAME)
    })

  it('names the subcategory code in each subcategory column', () => {
    expect(columns.filter(c => c.column_name === 'subcategory').map(c => [c.table, c.description])).toEqual([
      ['feather_dash.section_subcategory', "SAP's nine-digit subcategory code (`material_group_code`)."],
      ['feather_dash.display_location', "SAP's nine-digit subcategory code (`material_group_code`)."],
    ])
  })
})
