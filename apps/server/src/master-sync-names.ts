// #936: a master sync rule names Tables and columns. A rename through the
// ordinary rename carries those names, inside the rename's own transaction,
// so the next sync neither fails on an old name nor raises again a
// difference it has already raised.
import { createHash } from 'node:crypto'
import type { TxSql } from './db'

export const fingerprintOf = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')

interface DifferenceFields {
  kind: string; source_key: string; master_row: string | null
  column_name: string | null; source_value: string | null; featherbase_value: string | null
}

/** One fingerprint per difference: the same values, unresolved, never raise twice. */
export function differenceFingerprint(copied: string, masterTable: string, sourceSystem: string, d: DifferenceFields): string {
  return !d.column_name
    ? fingerprintOf(copied, masterTable, sourceSystem, d.kind, d.source_key, d.master_row)
    : fingerprintOf(copied, masterTable, sourceSystem, 'value', d.source_key, d.master_row, d.column_name, d.source_value, d.featherbase_value)
}

interface StoredRule {
  master_table: string
  source_system: string
  link: { table: string; system_column: string; key_column: string; master_column: string; kind_column?: string }
  columns: Record<string, { source: string; owner: string }>
  inactive?: { column: string; value: unknown }
}

async function rules(tx: TxSql) {
  return (await tx`select copied_table, rule from featherbase.master_sync for update`)
    .map((r) => ({ copied: String(r.copied_table), rule: r.rule as StoredRule }))
}

/** Differences already raised keep their fingerprints current, so a rename
 *  does not raise every open one again. */
async function refingerprint(tx: TxSql, copied: string, rule: StoredRule) {
  const rows = await tx`select fingerprint, kind, source_key, master_row, column_name, source_value, featherbase_value
    from featherbase.master_sync_difference where copied_table = ${copied}`
  for (const d of rows) {
    const next = differenceFingerprint(copied, rule.master_table, rule.source_system, d as unknown as DifferenceFields)
    if (next !== d.fingerprint)
      await tx`update featherbase.master_sync_difference set fingerprint = ${next}
        where copied_table = ${copied} and fingerprint = ${d.fingerprint as string}`
  }
}

/** The master Table or the link Table was renamed. (The copied table's own
 *  rename moves its rule by the foreign key.) */
export async function renameTableInSyncRules(tx: TxSql, from: string, to: string): Promise<void> {
  for (const { copied, rule } of await rules(tx)) {
    if (rule.master_table !== from && rule.link.table !== from) continue
    const masterMoved = rule.master_table === from
    if (masterMoved) rule.master_table = to
    if (rule.link.table === from) rule.link.table = to
    await tx`update featherbase.master_sync set rule = ${tx.json(rule as never)} where copied_table = ${copied}`
    if (masterMoved) await refingerprint(tx, copied, rule)
  }
}

/** A column of the master, link or copied Table was renamed. */
export async function renameColumnInSyncRules(tx: TxSql, table: string, from: string, to: string): Promise<void> {
  for (const { copied, rule } of await rules(tx)) {
    let changed = false
    let masterColumn = false
    if (rule.master_table === table && Object.hasOwn(rule.columns, from)) {
      rule.columns = Object.fromEntries(Object.entries(rule.columns).map(([field, spec]) => [field === from ? to : field, spec]))
      changed = masterColumn = true
    }
    if (rule.master_table === table && rule.inactive?.column === from) {
      rule.inactive.column = to
      changed = true
    }
    if (rule.link.table === table)
      for (const key of ['system_column', 'key_column', 'master_column', 'kind_column'] as const)
        if (rule.link[key] === from) {
          rule.link[key] = to
          changed = true
        }
    if (copied === table)
      for (const spec of Object.values(rule.columns))
        if (spec.source === from) {
          spec.source = to
          changed = true
        }
    if (!changed) continue
    await tx`update featherbase.master_sync set rule = ${tx.json(rule as never)} where copied_table = ${copied}`
    if (!masterColumn) continue
    // The last values seen are kept per master column: they move with it.
    await tx`update featherbase.master_sync_snapshot
      set source_values = (source_values - ${from}::text) || jsonb_build_object(${to}::text, source_values -> ${from}::text)
      where copied_table = ${copied} and source_values ? ${from}::text`
    await tx`update featherbase.master_sync_difference set column_name = ${to} where copied_table = ${copied} and column_name = ${from}`
    await refingerprint(tx, copied, rule)
  }
}
