// Spec 0005: revert an import run, row by row. RVT-R2's contract:
// POST /api/table/:table:import-revert { run_id, dry_run?, override? }.
//
// The mechanism, in one breath: RVT-R1 recorded every row the run wrote
// with the updated_at stamp the write left; a row whose stamp still
// matches had the import as its last writer, so an update restores the
// before-values from the version row the run produced, and an insert is
// deleted. A moved stamp means someone edited after the import — the row
// is SKIPPED and named (owner ruling 2026-08-11), unless the caller's
// `override` names it, which is only ever a second, explicit act (RVT-R5;
// the wizard offers it listing exactly the skipped rows). Everything runs
// the full save lifecycle — a revert is saveDoc updates and deleteDoc
// deletes, never raw SQL — so the revert itself is versioned (RVT-H1's
// recovery path).
import { AppError } from '../errors'
import { deleteDoc, saveDoc } from '../document'
import { ROW_KEY, getMeta, physicalRowKey } from '../meta'
import { assertDocPermission, permissionScope } from '../permissions'
import { registerCollectionAction } from '../actions'
import { sql } from '../db'
import { tableName } from '../doctype-engine'
import type { TouchedRow } from './collection-import'

type SkipReason =
  | 'edited-after'
  | 'row-deleted'
  | 'already-gone'
  | 'unchanged'
  | 'no-version-trail'

interface Skip {
  row_id: string
  reason: SkipReason
}

interface CurrentRow {
  updated_at: Date
  created_by: string
}

interface Plan {
  restores: { touched: TouchedRow; current: CurrentRow }[]
  deletes: { touched: TouchedRow; current: CurrentRow }[]
  skipped: Skip[]
}

const stampMatches = (t: TouchedRow, current: CurrentRow): boolean =>
  new Date(t.stamp).getTime() === current.updated_at.getTime()

// RVT-R3 + RVT-R4 as one decision table: for each recorded row, exactly one
// of restore / delete / skip(reason). Pure — the caller supplies current
// state; nothing here reads or writes.
export function planRevert(
  recorded: TouchedRow[],
  current: Map<string, CurrentRow>,
  override: Set<string>,
  trackChanges: boolean,
): Plan {
  const plan: Plan = { restores: [], deletes: [], skipped: [] }
  for (const t of recorded) {
    const cur = current.get(t.row_id)
    if (t.action === 'inserted') {
      if (!cur) plan.skipped.push({ row_id: t.row_id, reason: 'already-gone' })
      else if (stampMatches(t, cur) || override.has(t.row_id))
        plan.deletes.push({ touched: t, current: cur })
      else plan.skipped.push({ row_id: t.row_id, reason: 'edited-after' })
      continue
    }
    // action === 'updated'
    if (!cur) plan.skipped.push({ row_id: t.row_id, reason: 'row-deleted' })
    else if (!stampMatches(t, cur) && !override.has(t.row_id))
      plan.skipped.push({ row_id: t.row_id, reason: 'edited-after' })
    else if (!trackChanges) plan.skipped.push({ row_id: t.row_id, reason: 'no-version-trail' })
    else if (!t.version) plan.skipped.push({ row_id: t.row_id, reason: 'unchanged' })
    else plan.restores.push({ touched: t, current: cur })
  }
  return plan
}

// RVT-R6: the whole-request permission gate, before any write and before a
// dry run reports — restores need write, deletes need delete, own-rows
// scoping judged per row against the row's current creator.
async function assertRevertPermitted(user: string, table: string, plan: Plan): Promise<void> {
  if (plan.restores.length) {
    const scope = await permissionScope(user, table, 'write')
    if (scope !== 'all')
      for (const r of plan.restores)
        await assertDocPermission(user, table, 'write', r.current.created_by)
  }
  if (plan.deletes.length) {
    const scope = await permissionScope(user, table, 'delete')
    if (scope !== 'all')
      for (const d of plan.deletes)
        await assertDocPermission(user, table, 'delete', d.current.created_by)
  }
}

registerCollectionAction('import-revert', {
  effect: 'write',
  description:
    'Revert an import run ({ run_id }): rows the run updated get their ' +
    'prior values back from the version trail, rows it inserted are ' +
    'deleted; rows edited after the import are skipped and named, unless ' +
    'listed in override. With dry_run: true, reports the plan and writes ' +
    'nothing. Returns { restored, deleted, skipped, failed }.',
  handler: async ({ table, args, user }) => {
    const runId = args.run_id
    if (typeof runId !== 'string' || !runId)
      throw new AppError('ValidationError', 'Expected { run_id }')
    const overrideArg = args.override ?? []
    if (!Array.isArray(overrideArg) || overrideArg.some((n) => typeof n !== 'string'))
      throw new AppError('ValidationError', 'override must be an array of row ids')

    const meta = await getMeta(table)
    if (meta.kind !== 'table')
      throw new AppError('ValidationError', `Cannot revert an import on a ${meta.kind} Table`)
    if (meta.data_source)
      throw new AppError(
        'ValidationError',
        `${table} is bound to data source ${meta.data_source}; imports there are not revertable`,
      )

    // RVT-R2: resolve the run across ALL its parts.
    const parts = await sql`
      select row_id, touched from ${sql(tableName('Import Log'))}
      where ref_table = ${table} and run_id = ${runId}`
    if (!parts.length)
      throw new AppError('NotFoundError', `No import run ${runId} on ${table}`)
    const recorded: TouchedRow[] = parts.flatMap((p) =>
      Array.isArray(p.touched) ? (p.touched as TouchedRow[]) : [],
    )
    if (!recorded.length)
      throw new AppError(
        'ValidationError',
        `Import run ${runId} recorded no written rows (runs from before revert existed cannot be reverted)`,
      )

    const known = new Set(recorded.map((t) => t.row_id))
    const override = new Set(overrideArg as string[])
    for (const name of override)
      if (!known.has(name))
        throw new AppError('ValidationError', `override names ${name}, which this run never wrote`)

    // Current state of every recorded row, in one read.
    const names = [...known]
    const rows = await sql`
      select ${sql(physicalRowKey(table))} as row_id, updated_at, created_by
      from ${sql(tableName(table))}
      where ${sql(physicalRowKey(table))} = any(${names})`
    const current = new Map<string, CurrentRow>(
      rows.map((r) => [
        String(r.row_id),
        { updated_at: r.updated_at as Date, created_by: String(r.created_by) },
      ]),
    )

    const plan = planRevert(recorded, current, override, meta.track_changes)
    await assertRevertPermitted(user.row_id, table, plan)

    if (args.dry_run)
      return {
        dry_run: true,
        restored: plan.restores.length,
        deleted: plan.deletes.length,
        skipped: plan.skipped,
        failed: [],
      }

    // Before-values for every restore, in one read.
    const versionIds = plan.restores.map((r) => r.touched.version!)
    const versions = versionIds.length
      ? await sql`select row_id, data from version where row_id = any(${versionIds})`
      : []
    const beforeByVersion = new Map(versions.map((v) => [String(v.row_id), v.data]))

    let restored = 0
    let deleted = 0
    const failed: { row_id: string; message: string }[] = []
    for (const r of plan.restores) {
      const data = beforeByVersion.get(r.touched.version!) as
        | { changed?: [string, unknown, unknown][] }
        | undefined
      if (!data?.changed) {
        // The version row vanished (it is a normal table row) — without
        // before-values a restore would fabricate data.
        plan.skipped.push({ row_id: r.touched.row_id, reason: 'no-version-trail' })
        continue
      }
      const values: Record<string, unknown> = { [ROW_KEY]: r.touched.row_id }
      for (const [col, before] of data.changed) values[col] = before
      // The optimistic-concurrency stamp updateDoc demands — the row we
      // planned against, as ISO so milliseconds survive (spec 0004 lesson).
      values.updated_at = r.current.updated_at.toISOString()
      try {
        await saveDoc(table, values, user.row_id, 'upsert')
        restored++
      } catch (err) {
        failed.push({ row_id: r.touched.row_id, message: err instanceof Error ? err.message : String(err) })
      }
    }
    for (const d of plan.deletes) {
      try {
        await deleteDoc(table, d.touched.row_id, user.row_id, {
          expectUpdatedAt: d.current.updated_at.toISOString(),
        })
        deleted++
      } catch (err) {
        failed.push({ row_id: d.touched.row_id, message: err instanceof Error ? err.message : String(err) })
      }
    }

    // J1.5: the run's log entries record the revert. System-written like the
    // log itself; best-effort for the same reason writeImportLog is.
    const now = new Date().toISOString()
    for (const p of parts)
      await sql`
        update ${sql(tableName('Import Log'))}
        set reverted_at = ${now} where row_id = ${String(p.row_id)}`.catch(() => {})

    return { restored, deleted, skipped: plan.skipped, failed }
  },
})
