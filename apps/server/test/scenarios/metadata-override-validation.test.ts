// metadata-override-validation's fenced scenarios (#1070): saving and editing a
// Metadata Override through the public HTTP API, and the effective metadata it
// leaves. Each test is one fenced scenario of
// openspec/specs/metadata-override-validation/spec.md, step by step; a
// Scenario Outline runs once per Examples row. No screen is under test.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'

const scenario = scenarioFor(test, 'metadata-override-validation')

type Result = { status: number; body: { error?: { type: string; message: string } } & Record<string, unknown> }
type Column = Record<string, unknown> & { column_name: string; label?: string }
type Meta = { label: string; columns: Column[] }

const SETTINGS: Record<string, string> = { hidden: 'hidden', required: 'reqd', 'read-only': 'read_only', 'list visibility': 'in_list_view' }

/** A catalogue with a category column, and the one customization a scenario saves on it. */
class Catalogue {
  table = 'Override Catalogue'
  id = `${this.table}-adjustment`
  result!: Result
  missing = ''
  beforeRow: Record<string, unknown> | null = null
  beforeMeta: Meta | null = null

  constructor(readonly admin: TestClient) {}

  async prepare() {
    await this.admin.post('/api/table_def', {
      name: this.table,
      columns: [{ column_name: 'category', column_type: 'Data', label: 'Category' }],
    })
    return this
  }

  private async answer(res: Response) {
    this.result = { status: res.status, body: (await res.json()) as Result['body'] }
    return this.result
  }

  save(values: Record<string, unknown>) {
    return this.admin
      .fetch('/api/table/Metadata%20Override', { method: 'POST', body: JSON.stringify({ row_id: this.id, table_name: this.table, ...values }) })
      .then((res) => this.answer(res))
  }

  edit(values: Record<string, unknown>) {
    return this.admin
      .fetch(`/api/table/Metadata%20Override/${encodeURIComponent(this.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ updated_at: this.beforeRow!.updated_at, ...values }),
      })
      .then((res) => this.answer(res))
  }

  meta = () => this.admin.get<Meta>(`/api/table/${encodeURIComponent(this.table)}:meta`)
  savedRow = () => this.admin.get<Record<string, unknown>>(`/api/table/Metadata%20Override/${encodeURIComponent(this.id)}`)

  async remember() {
    this.beforeRow = await this.savedRow()
    this.beforeMeta = await this.meta()
  }

  permittedNames() {
    return this.result.body.error?.message.split('Permitted properties: ')[1]?.split(', ')
  }

  expectMissingColumn() {
    expect(this.result.status).toBe(417)
    expect(this.result.body.error?.type).toBe('ValidationError')
    expect(this.result.body.error?.message).toContain(this.missing)
    expect(this.result.body.error?.message).toContain(this.table)
  }

  expectBooleanRefusal() {
    expect(this.result.status).toBe(417)
    expect(this.result.body.error?.type).toBe('ValidationError')
    for (const value of ['true', 'false', '1', '0']) expect(this.result.body.error?.message).toContain(value)
  }

  expectPermitted(target: string) {
    expect(this.result.status).toBe(417)
    expect(this.result.body.error?.type).toBe('ValidationError')
    // An independent baseline pins the existing allowlists; not expectations derived from production.
    const expected = target === 'column'
      ? ['label', 'hidden', 'reqd', 'read_only', 'in_list_view', 'default_value', 'choices']
      : ['label', 'title_column', 'search_columns', 'sort_column', 'sort_direction', 'enable_assignments', 'enable_tags', 'enable_files', 'enable_discussion']
    expect(this.permittedNames()).toEqual(expected)
  }

  async expectUnchanged() {
    expect(await this.savedRow()).toEqual(this.beforeRow)
    expect(await this.meta()).toEqual(this.beforeMeta)
  }
}

const GIVEN = 'the user can customize a catalogue with a category column'

describe('metadata-override-validation', () => {
  scenario('A column label is not its name', async ({ admin }, step) => {
    let c!: Catalogue
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step('the user saves a customization using the category label instead of its name', async () => {
      c.missing = 'Category'
      await c.save({ column_name: c.missing, property: 'in_list_view', value: 'true' })
    })
    await step('the customization is refused with the missing column identified', () => c.expectMissingColumn())
  })

  scenario('A whole catalogue can still be renamed', async ({ admin }, step) => {
    let c!: Catalogue
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step('the user customizes the whole catalogue label without choosing a column', () =>
      c.save({ column_name: '', property: 'label', value: 'Customer catalogue' }))
    await step('the catalogue has the customized label', async () => {
      expect(c.result.status).toBe(201)
      expect((await c.meta()).label).toBe('Customer catalogue')
    })
  })

  scenario('A column from another catalogue is refused', async ({ admin }, step) => {
    let c!: Catalogue
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step('another catalogue has a supplier column', () =>
      admin.post('/api/table_def', { name: `${c.table} Suppliers`, columns: [{ column_name: 'supplier', column_type: 'Data' }] }))
    await step('the user saves a supplier customization on the category catalogue', async () => {
      c.missing = 'supplier'
      await c.save({ column_name: c.missing, property: 'label', value: 'Supplier' })
    })
    await step('the customization is refused with the missing column identified', () => c.expectMissingColumn())
  })

  scenario('A user-added category can be customized', async ({ admin, seed }, step) => {
    let c!: Catalogue
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step('the user has added a priority column to that catalogue', () =>
      seed('Custom Field', { row_id: `${c.table}-priority`, dt: c.table, column_name: 'priority', column_type: 'Data', label: 'Priority' }))
    await step('the user customizes the priority label', () => c.save({ column_name: 'priority', property: 'label', value: 'Urgency' }))
    await step('the user-added column has the customized label', async () => {
      expect(c.result.status).toBe(201)
      expect((await c.meta()).columns.find((col) => col.column_name === 'priority')?.label).toBe('Urgency')
    })
  })

  scenario('An invalid target edit keeps the saved customization', async ({ admin }, step) => {
    let c!: Catalogue
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step('a category label customization is saved', async () => {
      await c.save({ column_name: 'category', property: 'label', value: 'Product group' })
      await c.remember()
    })
    await step('the user edits that customization to use a missing column', async () => {
      c.missing = 'absent_category'
      await c.edit({ column_name: c.missing })
    })
    await step('the customization is refused with the missing column identified', () => c.expectMissingColumn())
    await step('the saved category customization is unchanged', () => c.expectUnchanged())
  })

  const BOOLEAN_INPUTS: Record<string, { value?: string }> = {
    'the text "truetrue"': { value: 'truetrue' },
    'the text "yes"': { value: 'yes' },
    'the text "2"': { value: '2' },
    'empty text': { value: '' },
    'no value': {},
  }

  scenario('An invalid boolean is refused', async ({ admin }, step, { input }) => {
    let c!: Catalogue
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step(`the user saves a visibility customization with ${input}`, () => {
      expect(Object.keys(BOOLEAN_INPUTS)).toContain(input)
      return c.save({ column_name: 'category', property: 'hidden', ...BOOLEAN_INPUTS[input!] })
    })
    await step('the customization is refused with the permitted boolean values', () => c.expectBooleanRefusal())
  })

  scenario('Both boolean choices take effect', async ({ admin }, step, { setting, value, effect }) => {
    let c!: Catalogue
    const property = SETTINGS[setting!]!
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step(`the user saves the "${setting}" customization with text "${value}"`, async () => {
      // Start at the opposite value so a no-op edit cannot satisfy either side.
      await c.save({ column_name: 'category', property, value: ['false', '0'].includes(value!) ? 'true' : 'false' })
      c.beforeRow = await c.savedRow()
      await c.edit({ value })
    })
    await step(`the "${setting}" customization takes effect as "${effect}"`, async () => {
      expect(c.result.status).toBe(200)
      const category = (await c.meta()).columns.find((col) => col.column_name === 'category')!
      expect(category[property]).toBe(effect === 'yes')
    })
  })

  scenario('An invalid boolean edit keeps the saved customization', async ({ admin }, step) => {
    let c!: Catalogue
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step('a hidden category customization is saved', async () => {
      await c.save({ column_name: 'category', property: 'hidden', value: 'true' })
      await c.remember()
    })
    await step('the user edits that customization to the text "yes"', () => c.edit({ value: 'yes' }))
    await step('the customization is refused with the permitted boolean values', () => c.expectBooleanRefusal())
    await step('the saved category customization is unchanged', () => c.expectUnchanged())
  })

  scenario('An unknown property is actionable for its target', async ({ admin }, step, { target }) => {
    let c!: Catalogue
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step(`the user saves a "${target}" customization with an unknown property`, () =>
      c.save({ column_name: target === 'column' ? 'category' : null, property: 'not_a_property', value: 'true' }))
    await step(`the customization is refused with the permitted "${target}" properties`, () => c.expectPermitted(target!))
  })

  scenario('Uniqueness remains prohibited', async ({ admin }, step) => {
    let c!: Catalogue
    await step(GIVEN, async () => { c = await new Catalogue(admin).prepare() })
    await step('the user saves a category uniqueness customization with text "true"', () =>
      c.save({ column_name: 'category', property: 'unique', value: 'true' }))
    await step('the customization is refused with the permitted "column" properties', () => c.expectPermitted('column'))
    await step('uniqueness is absent from the permitted properties', () => expect(c.permittedNames()).not.toContain('unique'))
  })
})
