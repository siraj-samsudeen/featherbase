// Deliberate concurrency tests need real roots, not one rollback connection.
// Keep their committed rows (including sessions/audit) out of the next test.
import { randomUUID } from 'node:crypto'
import { sql, withTransaction } from '../src/db'
import { storedEnvironment } from '../src/db-environment'
import { environment } from '../src/config'
import { suspendRuntimeApp, loadInstalledApps } from '../src/apps'
import { invalidateMeta } from '../src/meta'
import { invalidateSources } from '../src/sources/registry'
import { resetRateLimit } from '../src/rate-limit'

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
const tables = () => sql<{ schemaname: string; tablename: string }[]>`
  select schemaname, tablename from pg_tables
  where schemaname not like 'pg_%' and schemaname <> 'information_schema'
  order by schemaname, tablename`

export async function withCommittedDatabase(use: () => Promise<void>): Promise<void> {
  if (environment !== 'test' || await storedEnvironment() !== 'test')
    throw new Error('Committed fixtures require a database stamped test')
  const schema = `fixture_${randomUUID().replaceAll('-', '')}`
  const before = await tables()
  const schemas = new Set((await sql`select nspname from pg_namespace
    where nspname not like 'pg_%' and nspname <> 'information_schema'`).map(s => String(s.nspname)))
  const snapshot: { relation: string; copy: string; columns: string[]; writable: string[] }[] = []
  const sequences = await sql<{ schemaname: string; sequencename: string }[]>`
    select schemaname, sequencename from pg_sequences where schemaname not like 'pg_%'`
  const sequenceValues: { relation: string; last_value: string; is_called: boolean }[] = []
  await sql.unsafe(`create schema ${quote(schema)}`)
  try {
    for (const table of before) {
      const relation = `${quote(table.schemaname)}.${quote(table.tablename)}`
      const copy = `${quote(schema)}.t${snapshot.length}`
      const columns = await sql<{ column_name: string; is_generated: string }[]>`select column_name, is_generated from information_schema.columns
        where table_schema = ${table.schemaname} and table_name = ${table.tablename} order by ordinal_position`
      await sql.unsafe(`create table ${copy} as table ${relation}`)
      snapshot.push({ relation, copy, columns: columns.map(c => c.column_name), writable: columns.filter(c => c.is_generated === 'NEVER').map(c => c.column_name) })
    }
    for (const sequence of sequences) {
      const relation = `${quote(sequence.schemaname)}.${quote(sequence.sequencename)}`
      const [value] = await sql.unsafe(`select last_value::text, is_called from ${relation}`)
      sequenceValues.push({ relation, last_value: String(value.last_value), is_called: Boolean(value.is_called) })
    }
    try { await use() }
    finally {
      // The caller has drained requests before reaching here. Remove runtime
      // hooks before their app rows/schema disappear; restore baseline hooks last.
      for (const { name } of await sql`select name from installed_app`) suspendRuntimeApp(String(name))
      invalidateSources()
      await withTransaction(async () => {
        const current = await tables()
        const currentSchemas = await sql`select nspname from pg_namespace
          where nspname not like 'pg_%' and nspname <> 'information_schema'`
        for (const { nspname: added } of currentSchemas) {
          if (added !== schema && !schemas.has(added)) await sql.unsafe(`drop schema ${quote(added)} cascade`)
        }
        const originals = new Set(snapshot.map(t => t.relation))
        for (const table of current) {
          const relation = `${quote(table.schemaname)}.${quote(table.tablename)}`
          if (schemas.has(table.schemaname) && !originals.has(relation)) await sql.unsafe(`drop table ${relation} cascade`)
        }
        // FK cycles are normal in metadata. This is a test-stamped disposable
        // database, using the same privileged role as the migration fixtures.
        await sql.unsafe('set local session_replication_role = replica')
        await sql.unsafe(`truncate ${snapshot.map(t => t.relation).join(', ')} cascade`)
        for (const table of snapshot) {
          const currentColumns = await sql`select attname from pg_attribute where attrelid = ${table.relation}::regclass and attnum > 0 and not attisdropped`
          for (const column of currentColumns) if (!table.columns.includes(String(column.attname)))
            await sql.unsafe(`alter table ${table.relation} drop column ${quote(String(column.attname))} cascade`)
          const writable = table.writable.map(quote).join(', ')
          await sql.unsafe(`insert into ${table.relation} (${writable}) overriding system value select ${writable} from ${table.copy}`)
        }
        for (const sequence of sequenceValues)
          await sql`select setval(${sequence.relation}::regclass, ${sequence.last_value}::bigint, ${sequence.is_called})`
        await sql.unsafe(`drop schema ${quote(schema)} cascade`)
      })
      invalidateMeta()
      resetRateLimit()
      await loadInstalledApps()
    }
  } finally {
    await sql.unsafe(`drop schema if exists ${quote(schema)} cascade`)
  }
}
