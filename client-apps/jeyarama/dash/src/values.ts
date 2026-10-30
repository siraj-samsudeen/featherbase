// Small value rules shared by the validators, the coverage rules and today's
// derivation. Rows reach the app as JSON: a Date column may arrive as
// 'YYYY-MM-DD' or as a full ISO timestamp, a Check as a boolean or '0'/'1'.

/** A store's plant code and a subcategory code (SAP's `material_group_code`), as the scope filters carry them. */
export const PLANT_CODE = /^\d{4}$/
export const MATERIAL_GROUP = /^\d{9}$/

/** A name as names are compared: trimmed, inner spaces collapsed, case-folded. */
export function fold(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** A value exactly as stored, or '' for nothing: how the platform's filters match it. */
export function exact(value: unknown): string {
  return value == null ? '' : String(value)
}

/** Text with surrounding space removed, or '' for nothing. For display and names only, never for codes or ids. */
export function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

/** The calendar day of a Date column's value, or '' for none. */
export function day(value: unknown): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text(value))
  return match ? match[1] : ''
}

/** A Check column's value as a boolean. */
export function checked(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

/** Does a dated row hold on `on`? starts_on is inclusive, ends_on exclusive and empty means current. */
export function holdsOn(row: { starts_on?: unknown; ends_on?: unknown }, on: string): boolean {
  const start = day(row.starts_on)
  const end = day(row.ends_on)
  return !!start && start <= on && (!end || on < end)
}
