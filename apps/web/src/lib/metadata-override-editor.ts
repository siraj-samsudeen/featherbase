import { METADATA_OVERRIDE_PROPERTIES, METADATA_OVERRIDE_BOOLEAN_VALUES, prettifyLabel } from 'shared'
import type { ColumnDef, TableMeta } from './meta'

type Row = Record<string, unknown>
const WHOLE_TABLE = 'Whole Table'
const settingLabel = (property: string) => `${prettifyLabel(property)} (${property})`

function properties(row: Row): Readonly<Record<string, 'text' | 'boolean'>> {
  return row.column_name ? METADATA_OVERRIDE_PROPERTIES.column : METADATA_OVERRIDE_PROPERTIES.table
}

function booleanSetting(row: Row): boolean {
  const allowed = properties(row)
  const property = String(row.property ?? '')
  return Object.hasOwn(allowed, property) && allowed[property] === 'boolean'
}

// Only presentation changes: FormView's existing controls still render the
// fields and its original metadata still validates/saves the text wire shape.
export function overrideControl(field: ColumnDef, row: Row, target?: TableMeta): { field: ColumnDef; value: unknown } {
  let value = row[field.column_name]
  const ready = Boolean(target)
  if (field.column_name === 'column_name') {
    field = { ...field, column_type: 'Choice', reqd: true,
      choices: [WHOLE_TABLE, ...(target?.columns.map(c => c.column_name) ?? [])].join('\n'),
      read_only: field.read_only || !ready,
      description: 'Choose Whole Table for settings that apply to the Table itself.' }
    if (value === '' || value === null) value = WHOLE_TABLE
  } else if (field.column_name === 'property') {
    const allowed = properties(row)
    field = { ...field, column_type: 'Choice', choices: Object.keys(allowed).map(settingLabel).join('\n'),
      read_only: field.read_only || !ready || row.column_name === undefined }
    if (Object.hasOwn(allowed, String(value))) value = settingLabel(String(value))
  } else if (field.column_name === 'value') {
    const property = String(row.property ?? '')
    field = { ...field, read_only: field.read_only || !ready || !Object.hasOwn(properties(row), property) }
    if (booleanSetting(row)) {
      field = { ...field, column_type: 'Check', description: 'Checked = Yes. Unchecked = No.' }
      const text = String(value ?? '')
      value = Object.hasOwn(METADATA_OVERRIDE_BOOLEAN_VALUES, text) && METADATA_OVERRIDE_BOOLEAN_VALUES[text]
    } else if (property === 'choices') {
      field = { ...field, column_type: 'Text', description: 'One choice per line.' }
    }
  }
  return { field, value }
}

export function changeOverride(row: Row, name: string, value: unknown): Row {
  if (name === 'table_name') return { ...row, table_name: value, column_name: undefined, property: undefined, value: undefined }
  if (name === 'column_name') return { ...row, column_name: value === WHOLE_TABLE ? '' : value || undefined, property: undefined, value: undefined }
  if (name === 'property') {
    const property = Object.keys(properties(row)).find(p => p === value || settingLabel(p) === value) ?? value
    const next = { ...row, property, value: undefined } as Row
    if (booleanSetting(next)) next.value = 'false'
    return next
  }
  return { ...row, [name]: name === 'value' && typeof value === 'boolean' && booleanSetting(row) ? String(value) : value }
}
