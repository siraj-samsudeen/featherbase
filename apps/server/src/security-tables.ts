import { AppError } from './errors'
import { isPrivileged } from './permissions'

// #437: the Tables that decide who may do what. Writing them is System
// Manager work whatever the Permission rows say: a grant on one of them must
// never be what stands between an ordinary role and every other grant. Reads
// stay governed by the normal permission checks. The Sales Target scope
// Tables are ordinary instance Tables, but their rows decide which stores and
// groups a person's report covers, so they sit here too. Server Scripts,
// Workflows and Assignment Rules make the system act on other people's rows
// on their behalf, so writing them is System Manager work as well.
//
// A sibling of #432's assertNotSystemWritten: called from the same public
// write entry points (document.ts, applyWorkflowAction), after it.
export const SECURITY_TABLES: ReadonlySet<string> = new Set([
  'Permission',
  'Role',
  'Has Role',
  'Data Scope',
  'Share',
  'Sign In Method',
  'Identifier System',
  'Installed App',
  'Sales Target Assignment',
  'Employee Section Map',
  'Section Ownership',
  'Store Manager',
  'Section Merchandise Map',
  'Section Name Alias',
  'Server Script',
  'Workflow',
  'Assignment Rule',
])

/** Person columns that change what a person may do: only a System Manager
 *  sets them on an existing person (roles also on a new one). */
export const PERSON_ACCESS_COLUMNS = ['roles', 'enabled'] as const

/** Does writing `column` of `table` change who can do what? True for every
 *  column of a security Table and for a Person's access columns. Workflows
 *  and Assignment Rules write a column directly, outside the save path, so
 *  they may never target one. */
export function isAccessTarget(table: string, column: string): boolean {
  if (SECURITY_TABLES.has(table)) return true
  return table === 'Person' && (PERSON_ACCESS_COLUMNS as readonly string[]).includes(column)
}

export function assertNotAccessTarget(table: string, column: string, what: string): void {
  if (isAccessTarget(table, column))
    throw new AppError('ValidationError', `${what} cannot write ${table}.${column}: it decides who can do what`, { [what === 'A workflow' ? 'state_field' : 'assign_to_field']: 'not an access column' })
}

export function securityRefusal(what: string): AppError {
  return new AppError('PermissionError', `Only a System Manager can change ${what}`)
}

/** Refuse a write to a security Table unless the writer is privileged.
 *  `trusted` is the save's skipPermissions flag: a surface trusted to bypass
 *  ordinary grants (a web form) is still not trusted with access control. */
export async function assertSecurityWriter(
  table: string,
  user: string,
  opts: { trusted?: boolean } = {},
): Promise<void> {
  if (!SECURITY_TABLES.has(table)) return
  if (!opts.trusted && (await isPrivileged(user))) return
  throw securityRefusal(`${table} rows`)
}
