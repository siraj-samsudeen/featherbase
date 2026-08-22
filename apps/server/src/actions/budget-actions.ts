import { AppError } from '../errors'
import { registerRowAction } from '../actions'
import { sql } from '../db'
import { assertPermission } from '../permissions'
import { BOOK, baselineBook, closeBook, snapshotActiveBook } from '../budget'

// Spec 0007, BUD-R2: the Budget Book lifecycle actions. Row actions are
// registered globally (like submit/cancel) — each handler gates itself to
// Budget Book rows. All three require write permission on Budget Book and
// run in one transaction (the baseline's snapshot and lifecycle flip are
// atomic).

function onlyBooks(table: string, action: string): void {
  if (table !== BOOK)
    throw new AppError('ValidationError', `:${action} applies to ${BOOK} rows`)
}

registerRowAction('baseline', {
  effect: 'write',
  description:
    'Freeze a working Budget Book: writes the v0 baseline snapshot and activates governance (Budget Book only).',
  handler: async ({ table, name, user }) => {
    onlyBooks(table, 'baseline')
    await assertPermission(user.row_id, BOOK, 'write')
    return sql.begin((tx) => baselineBook(tx as unknown as typeof sql, name, user.row_id))
  },
})

registerRowAction('close', {
  effect: 'write',
  description:
    'Close an active Budget Book at cycle end: governance ends, snapshots and the Version trail remain the history (Budget Book only).',
  handler: async ({ table, name, user }) => {
    onlyBooks(table, 'close')
    await assertPermission(user.row_id, BOOK, 'write')
    return sql.begin((tx) => closeBook(tx as unknown as typeof sql, name, user.row_id))
  },
})

registerRowAction('snapshot', {
  effect: 'write',
  description:
    'Snapshot an active Budget Book as a named version, e.g. after a reforecast: { label, kind: "reforecast" | "adhoc" } (Budget Book only).',
  handler: async ({ table, name, args, user }) => {
    onlyBooks(table, 'snapshot')
    const label = typeof args.label === 'string' ? args.label.trim() : ''
    if (!label) throw new AppError('ValidationError', 'Expected { label }')
    const kind = args.kind ?? 'adhoc'
    if (kind !== 'reforecast' && kind !== 'adhoc')
      throw new AppError('ValidationError', 'kind must be "reforecast" or "adhoc"')
    await assertPermission(user.row_id, BOOK, 'write')
    return sql.begin((tx) =>
      snapshotActiveBook(tx as unknown as typeof sql, name, label, kind, user.row_id),
    )
  },
})
