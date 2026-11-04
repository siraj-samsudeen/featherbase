// #917: how an app manifest's permission declarations are read. Imports
// nothing, so the migration that converts installed records can use it.

/** '*' is every Column; '@basic' is every Column of the basic level, which is
 *  what a 2026-10 flag declaration granted. Both follow Columns an upgrade adds. */
export type ColumnLevel = '*' | '@basic'

const LEGACY_FLAGS = [
  ['can_read', 'read'], ['can_create', 'create'], ['can_write', 'update'], ['can_delete', 'delete'],
  ['can_submit', 'submit'], ['can_cancel', 'cancel'], ['can_amend', 'amend'],
] as const
const LEGACY_KEYS = new Set(['tier', 'own_rows_only', ...LEGACY_FLAGS.map(([flag]) => flag)])

/** #917: released manifests (and the installed records of them) declare a
 *  grant as basic-level flags. Read that exact meaning as operations: never a
 *  restricted level, which no released manifest used and which has no
 *  flag-free equivalent here. Anything else passes through unchanged. */
export function readLegacyPermission(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input) || 'operations' in input) return input
  const declared = input as Record<string, unknown>
  if (!Object.keys(declared).some((key) => LEGACY_KEYS.has(key))) return input
  // A restricted-level grant stays as declared, so the schema refuses it.
  if ((declared.tier ?? 'basic') !== 'basic') return input
  const operations: Record<string, unknown> = {}
  for (const [flag, operation] of LEGACY_FLAGS)
    if (declared[flag] === true) operations[operation] = ['read', 'create', 'update'].includes(operation) ? '@basic' : true
  const rest = Object.fromEntries(Object.entries(declared).filter(([key]) => !LEGACY_KEYS.has(key)))
  return { ...rest, ...(declared.own_rows_only === true ? { scope_mode: 'creator' } : {}), operations }
}
