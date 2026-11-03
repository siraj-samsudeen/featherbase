// The same property contract drives server validation and the override editor.
// Keep the Table and Column scopes separate; uniqueness is not overridable.
export const METADATA_OVERRIDE_PROPERTIES = {
  table: {
    label: 'text',
    title_column: 'text',
    search_columns: 'text',
    sort_column: 'text',
    sort_direction: 'text',
  },
  column: {
    label: 'text',
    hidden: 'boolean',
    reqd: 'boolean',
    read_only: 'boolean',
    in_list_view: 'boolean',
    default_value: 'text',
    choices: 'text',
  },
} as const

// Metadata Override.value remains a Data column: these are text, not JSON booleans.
export const METADATA_OVERRIDE_BOOLEAN_VALUES: Readonly<Record<string, boolean>> = {
  true: true,
  false: false,
  1: true,
  0: false,
}
