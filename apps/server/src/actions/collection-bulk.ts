// #332: the list's bulk edit and bulk delete, one request for every selected
// row instead of one per row from the browser.
//   POST /api/table/:table:bulk-edit   { rows: [row_id, …], values: { column: value } }
//   POST /api/table/:table:bulk-delete { rows: [row_id, …] }
//
// Each row goes through the normal row lifecycle (saveDoc / deleteDoc), so
// permissions, validation and automation triggers are exactly a single row's.
// On a platform Table every row runs in one transaction: the first row that
// fails rolls all of them back, and the refusal names that row and keeps the
// row's own reason and fields. A connected Table's store cannot join that
// transaction, so there every row is tried and the answer lists the rows that
// failed, each with its reason.
import { AppError } from '../errors'
import { deleteDoc, getDoc, saveDoc } from '../document'
import { ROW_KEY, getMeta } from '../meta'
import { registerCollectionAction } from '../actions'
import { actionTransaction } from '../action-transaction'
import { publishDocEvent } from '../realtime'
import { isBound } from '../sources/dispatch'
import type { SessionUser } from '../auth'

// A list page is far smaller; this only bounds a hand-made request.
const MAX_ROWS = 500

interface FailedRow {
  row_id: string
  message: string
  fields?: Record<string, string>
}

function rowsOf(args: Record<string, unknown>): string[] {
  const rows = args.rows
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every((r) => typeof r === 'string' && r !== ''))
    throw new AppError('ValidationError', 'Expected { rows: [row id, …] } with at least one row')
  if (rows.length > MAX_ROWS)
    throw new AppError('ValidationError', `A bulk change is capped at ${MAX_ROWS} rows per request`)
  return [...new Set(rows as string[])]
}

function valuesOf(args: Record<string, unknown>): Record<string, unknown> {
  const values = args.values
  if (typeof values !== 'object' || values === null || Array.isArray(values) || Object.keys(values).length === 0)
    throw new AppError('ValidationError', 'Expected { values: { column: value } } with at least one column')
  for (const key of [ROW_KEY, 'updated_at'])
    if (key in values) throw new AppError('ValidationError', `A bulk edit cannot set ${key}`)
  return values as Record<string, unknown>
}

// The row's current stamp, read through the caller's own permissions. Echoing
// it makes the write a plain single-row save; on a connected Table it also
// makes a row that moved under us conflict instead of being overwritten.
async function stampOf(table: string, name: string, user: SessionUser): Promise<unknown> {
  return (await getDoc(table, name, user.row_id)).updated_at
}

async function editRow(table: string, name: string, values: Record<string, unknown>, user: SessionUser) {
  const updated_at = await stampOf(table, name, user)
  await saveDoc(table, { ...values, [ROW_KEY]: name, updated_at }, user.row_id)
}

async function deleteRow(table: string, name: string, user: SessionUser, bound: boolean) {
  const stamp = bound ? await stampOf(table, name, user) : null
  await deleteDoc(table, name, user.row_id, {
    expectUpdatedAt: stamp == null ? null : stamp instanceof Date ? stamp.toISOString() : String(stamp),
  })
}

async function runBulk(
  table: string,
  rows: string[],
  verb: 'changed' | 'deleted',
  apply: (name: string) => Promise<void>,
): Promise<{ done: number; failed?: FailedRow[] }> {
  const meta = await getMeta(table)
  if (isBound(meta)) {
    const failed: FailedRow[] = []
    let done = 0
    for (const name of rows) {
      try {
        await apply(name)
        done++
        publishDocEvent(table, name, verb === 'deleted' ? 'deleted' : 'updated')
      } catch (err) {
        if (!(err instanceof AppError)) throw err
        failed.push({ row_id: name, message: err.message, ...(err.fields ? { fields: err.fields } : {}) })
      }
    }
    return { done, failed }
  }
  await actionTransaction(async () => {
    for (const name of rows) {
      try {
        await apply(name)
      } catch (err) {
        if (!(err instanceof AppError)) throw err
        throw new AppError(err.type, `No rows were ${verb}. ${name}: ${err.message}`, err.fields)
      }
    }
  })
  for (const name of rows) publishDocEvent(table, name, verb === 'deleted' ? 'deleted' : 'updated')
  return { done: rows.length }
}

registerCollectionAction('bulk-edit', {
  effect: 'write',
  description:
    'Set the same values on several rows ({ rows: [...], values: { column: value } }); returns { changed }. ' +
    'All-or-nothing on a platform Table; on a connected Table every row is tried and failures are listed ({ changed, failed }).',
  handler: async ({ table, args, user }) => {
    const rows = rowsOf(args)
    const values = valuesOf(args)
    const { done, failed } = await runBulk(table, rows, 'changed', (name) => editRow(table, name, values, user))
    return failed ? { changed: done, failed } : { changed: done }
  },
})

registerCollectionAction('bulk-delete', {
  effect: 'write',
  description:
    'Delete several rows ({ rows: [...] }); returns { deleted }. ' +
    'All-or-nothing on a platform Table; on a connected Table every row is tried and failures are listed ({ deleted, failed }).',
  handler: async ({ table, args, user }) => {
    const rows = rowsOf(args)
    const bound = isBound(await getMeta(table))
    const { done, failed } = await runBulk(table, rows, 'deleted', (name) => deleteRow(table, name, user, bound))
    return failed ? { deleted: done, failed } : { deleted: done }
  },
})
