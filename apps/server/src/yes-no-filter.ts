// #742: a Yes/No filter value is read by the shared rule (packages/shared), the
// same one the web's quick filter box uses, for normal and connected Tables.
export { readYesNo } from 'shared'

/** Whether this filter compares a Yes/No column by its value. */
export function isYesNoFilter(
  columns: readonly { column_name: string; column_type: string }[],
  field: string,
  op: string,
): boolean {
  return (
    (op === '=' || op === '!=') &&
    columns.some((c) => c.column_name === field && c.column_type === 'Check')
  )
}
