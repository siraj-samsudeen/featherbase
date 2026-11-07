// Small value rules. Rows reach the app as JSON: a Date column may arrive as
// 'YYYY-MM-DD' or as a full ISO timestamp, a Check as a boolean or '0'/'1'.

/** A value exactly as stored, or '' for nothing: how the platform's filters match it. */
export function exact(value: unknown): string {
  return value == null ? '' : String(value)
}

/** Text with surrounding space removed, or '' for nothing. For display and names only, never for codes or ids. */
export function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

/**
 * The calendar day of a Date column's value, or '' for none. A save rule sees an update's
 * unchanged columns as the database client returns them: a Date at UTC midnight.
 */
export function day(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
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

/** Status columns of core Tables whose names may change soon: each name is written here alone. */
export const EMPLOYEE_STATUS = 'employee_status'
export const SECTION_STATUS = 'section_status'
