import { AppError } from './errors'
import { isPrivileged } from './permissions'
import { getMeta } from './meta'

// #437: the Tables that decide who may do what. Writing them is System
// Manager work whatever the Permission rows say: a grant on one of them must
// never be what stands between an ordinary role and every other grant. Reads
// stay governed by the normal permission checks. The Sales Target scope
// Tables are ordinary instance Tables, but their rows decide which stores and
// groups a person's report covers, so they sit here too — until the go-live
// cut-over, when the instance's setup marks them `decides_scope` (#559) and
// their names leave this list (task 2.1 of feather-dash-installed-app). A
// Table marked `decides_scope` is guarded the same way (isSecurityTable). Server Scripts,
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
  // #620: an app's settings and which roles carry its roles.
  'App Setting',
  'App Role Binding',
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

/** #559: a security Table is one named above, or one whose own definition
 *  marks it as deciding people's scope (`decides_scope`). The mark, not this
 *  list, is how an instance or an app protects its roster Tables. */
export async function isSecurityTable(table: string): Promise<boolean> {
  if (SECURITY_TABLES.has(table)) return true
  const meta = await getMeta(table).catch(() => null)
  return meta?.decides_scope === true
}

/** Person columns that change what a person may do: only a System Manager
 *  sets them on an existing person (roles, and expecting Google sign-in, also
 *  on a new one: #473 — it lets a Google account link by address alone). */
const PERSON_ACCESS_COLUMNS = ['roles', 'enabled', 'expects_google_sign_in'] as const

/** Does writing `column` of `table` change who can do what? True for every
 *  column of a security Table and for a Person's access columns. Workflows
 *  and Assignment Rules write a column directly, outside the save path, so
 *  they may never target one. */
export async function isAccessTarget(table: string, column: string): Promise<boolean> {
  if (await isSecurityTable(table)) return true
  return table === 'Person' && (PERSON_ACCESS_COLUMNS as readonly string[]).includes(column)
}

export async function assertNotAccessTarget(table: string, column: string, what: string): Promise<void> {
  if (await isAccessTarget(table, column))
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
  if (!(await isSecurityTable(table))) return
  if (!opts.trusted && (await isPrivileged(user))) return
  throw securityRefusal(`${table} rows`)
}
