import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AppError } from './errors'
import { sql } from './db'
import { pgType, quoteRelation, STANDARD_COLUMNS, type TableDef } from './table-engine'
import { invalidateMeta } from './meta'

export const packageVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
export function compareVersions(a: string, b: string): number {
  const left = packageVersion.parse(a).split('.').map(BigInt)
  const right = packageVersion.parse(b).split('.').map(BigInt)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export const checksum = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
export function refuse(message: string): never { throw new AppError('ValidationError', message) }

// @spec runtime_upgrade_reviewed_plan.destructive_upgrade_refused
const addition = z.object({
  kind: z.literal('addColumn'),
  table: z.string(),
  column: z.object({
    column_name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    label: z.string().min(1),
    column_type: z.enum(['Data', 'Text', 'Int', 'Float', 'Check', 'Date', 'Datetime']),
  }).strict(),
}).strict()
export const migrationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,80}$/),
  fromVersion: packageVersion,
  toVersion: packageVersion,
  operations: z.array(addition),
}).strict()
export type PackageMigration = z.infer<typeof migrationSchema>
export type MigrationEntry = { id: string; checksum: string }
export const migrationLedger = (migrations: PackageMigration[]): MigrationEntry[] =>
  migrations.map(m => ({ id: m.id, checksum: checksum(m) }))

// Reverse/replay makes the final declaration and cumulative history one contract.
// @spec runtime_upgrade_identity.upgrade_history_is_a_prefix
export function validateMigrations(name: string, version: string, tables: TableDef[], migrations: PackageMigration[]) {
  const ids = new Set<string>()
  let previous: string | undefined
  for (const migration of migrations) {
    if (ids.has(migration.id) || (previous && previous !== migration.fromVersion) ||
        compareVersions(migration.toVersion, migration.fromVersion) <= 0)
      refuse('Migration history has duplicate, reordered or skipped steps')
    ids.add(migration.id)
    previous = migration.toVersion
  }
  if (previous && previous !== version) refuse('Migration history does not reach the package version')
  const baseline = structuredClone(tables)
  for (const migration of [...migrations].reverse()) {
    for (const op of [...migration.operations].reverse()) {
      const table = baseline.find(t => t.name === op.table)
      if (!table || !op.table.startsWith(`${name}.`) || (table.kind && table.kind !== 'table') ||
          (STANDARD_COLUMNS as readonly string[]).includes(op.column.column_name))
        refuse('Migration must add an optional scalar column to an owned ordinary Table')
      const last = table.columns.at(-1)
      if (canonical(last) !== canonical(op.column))
        refuse('Migration additions must exactly match appended final columns')
      table.columns.pop()
      if (!table.columns.length || table.columns.some(c => c.column_name === op.column.column_name))
        refuse('Migration column already exists or baseline Table is empty')
    }
  }
  return baseline
}

// @spec runtime_upgrade_preserves_owned_work
export async function applyAdditions(migrations: PackageMigration[], owner: string) {
  for (const migration of migrations) for (const op of migration.operations) {
    const [table] = await sql`select owner_app, physical_schema, physical_relation, kind
      from table_def where name = ${op.table}`
    if (table?.owner_app !== owner || table.kind !== 'table' || !table.physical_schema || !table.physical_relation)
      refuse('Migration Table ownership or physical storage does not match; restore package metadata first')
    const relation = quoteRelation(`${table.physical_schema}.${table.physical_relation}`)
    const [{ position }] = await sql`select coalesce(max(position), 0) + 1 as position from column_def where parent = ${op.table}`
    await sql`insert into column_def ${sql({ parent: op.table, position, ...op.column })}`
    // No IF NOT EXISTS: a physical-only collision is drift, not successful migration.
    await sql.unsafe(`alter table ${relation} add column "${op.column.column_name}" ${pgType(op.column.column_type)}`)
  }
  invalidateMeta()
}
