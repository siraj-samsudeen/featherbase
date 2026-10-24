// How a Reference picker searches and labels the rows of its target Table.
// person-rename: Person and Service Account ids are opaque (`psn_…`,
// `svc_…`), so their pickers search and show names, never ids. The Person
// picker never offers a built-in account (Administrator, Guest); a service
// account is never offered where a person is chosen, by construction (its
// own Table).
export interface PickerSpec {
  /** The column typed text is matched against. */
  searchField: string
  /** The column shown for a row; null shows the row id. */
  labelField: string | null
  /** Filters every search carries. */
  filters: unknown[]
  /** Search through the server's people directory (name, @username,
   *  address, employee code) rather than one column. */
  peopleSearch?: boolean
}

const SPECS: Record<string, PickerSpec> = {
  // person-resolution D1: a replaced (merged-away) record is never offered either.
  Person: { searchField: 'full_name', labelField: 'full_name', filters: [['built_in', '=', false], ['replaced_by', '=', null]], peopleSearch: true },
  'Service Account': { searchField: 'label', labelField: 'label', filters: [] },
}

export function pickerFor(table: string): PickerSpec {
  return SPECS[table] ?? { searchField: 'row_id', labelField: null, filters: [] }
}
