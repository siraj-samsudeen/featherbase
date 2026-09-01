import { AppError } from '../errors'
import type { HookContext, TableController } from '../controllers'
import { tableName } from '../table-engine'
import type { RowValues } from '../document'
import {
  CHANGE,
  DISCONTINUED_FLAG,
  MAX_CHANGE_LINES,
  applyChange,
  keyCollides,
  keySignature,
  loadBook,
  overDoa,
  parseNewLineKey,
  type BookBinding,
} from '../budget'

// Spec 0007, BUD-R4: a Budget Change computes its own facts on every save —
// snapped current values, per-line deltas, total_delta, crosses_owner — and
// validates its lines per change_type. BUD-R5: approval (the submit
// transition, direct or workflow-driven) applies the lines inside the same
// transaction. BUD-R9: applied changes are history — cancel is refused.

const num = (v: unknown): number => (v == null || v === '' ? 0 : Number(v))

const reject = (message: string): never => {
  throw new AppError('ValidationError', message)
}

// Lines arrive in the payload when sent; an update that omitted them means
// "unchanged" — load the stored rows AND put them back on the row, so every
// save re-snaps current values (BUD-R4's property: snapped == live at last
// save time, whatever field that save touched).
async function resolveLines(ctx: HookContext): Promise<RowValues[]> {
  if (Array.isArray(ctx.row.lines)) return ctx.row.lines as RowValues[]
  if (ctx.isNew) return []
  const rows = await ctx.tx`
    select * from ${ctx.tx(tableName('Budget Change Line'))}
    where parent = ${String(ctx.row.row_id)} and parenttype = ${CHANGE}
    order by position`
  const lines = rows.map((r) => ({ ...(r as RowValues) }))
  ctx.row.lines = lines
  return lines
}

async function loadStoredLines(ctx: HookContext): Promise<RowValues[]> {
  const rows = await ctx.tx`
    select * from ${ctx.tx(tableName('Budget Change Line'))}
    where parent = ${String(ctx.row.row_id)} and parenttype = ${CHANGE}
    order by position`
  return rows.map((r) => ({ ...(r as RowValues) }))
}

async function requireBook(ctx: HookContext): Promise<BookBinding> {
  const bookName = String(ctx.row.book ?? '')
  const book = bookName ? await loadBook(ctx.tx, bookName) : null
  if (!book) reject(`book "${bookName}" is not a Budget Book`)
  return book!
}

const controller: TableController = {
  table: CHANGE,
  hooks: {
    validate: async (ctx) => {
      const { row, tx } = ctx
      const book = await requireBook(ctx)
      const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
      if (!reason) reject('reason is required — every Budget Change carries one')
      row.reason = reason
      if (book.lifecycle !== 'active')
        reject(
          `${book.name} is ${book.lifecycle} — a Budget Change needs an active book` +
            (book.lifecycle === 'working' ? ' (a working book is edited directly)' : ''),
        )
      const type = String(row.change_type ?? 'revise')
      const lines = await resolveLines(ctx)
      if (!lines.length) reject('a Budget Change needs at least one line')
      if (lines.length > MAX_CHANGE_LINES)
        reject(`a Budget Change holds at most ${MAX_CHANGE_LINES} lines`)

      const effective =
        row.effective_from == null || row.effective_from === '' ? null : String(row.effective_from)
      if (type === 'discontinue') {
        if (!effective || !book.measureColumns.includes(effective))
          reject(`effective_from must name one of ${book.name}'s measure columns`)
      } else if (effective) {
        reject('effective_from applies only to discontinue changes')
      }

      const boundTbl = tableName(book.refTable)
      const owners = new Set<string>()
      const seenCells = new Set<string>()
      let total = 0

      const liveRow = async (ref: string): Promise<RowValues> => {
        const [live] = await tx`
          select * from ${tx(boundTbl)} where row_id = ${ref}`
        if (!live) reject(`line ${ref} does not exist in ${book.refTable}`)
        return live as RowValues
      }
      // BUD-R13 (review P0-4): current_value is the ENGINE's snapshot and is
      // deliberately re-snapped on every save, so it cannot also be the
      // concurrency token. observed_value is what the author saw; the engine
      // never assigns it, and any drift from live means someone else moved
      // the number under this proposal — a 409, not a silent re-snap.
      const guardObservation = (ref: string, col: string, l: RowValues, live: number) => {
        if (l.observed_value == null || l.observed_value === '') return
        const seen = num(l.observed_value)
        if (seen === live) return
        throw new AppError(
          'ConflictError',
          `${book.refTable} ${ref} ${col} is now ${live}, but this proposal was written against ${seen} — reopen the line to see the current value before proposing`,
        )
      }
      const collectOwner = (live: RowValues) => {
        if (book.ownerColumn && live[book.ownerColumn] != null)
          owners.add(String(live[book.ownerColumn]))
      }
      const dedupe = (cell: string, what: string) => {
        if (seenCells.has(cell)) reject(`duplicate ${what} in one change`)
        seenCells.add(cell)
      }

      for (const l of lines) {
        const ref = l.line_ref == null || l.line_ref === '' ? null : String(l.line_ref)
        if (type === 'new_line') {
          if (ref) reject('a new_line line carries new_line_key, not line_ref')
          const key = parseNewLineKey(l.new_line_key)
          const keyCols = Object.keys(key)
          const missing = book.keyColumns.filter((c) => !(c in key) || key[c] == null || key[c] === '')
          if (missing.length)
            reject(`new_line_key is missing key column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`)
          const extra = keyCols.filter((c) => !book.keyColumns.includes(c))
          if (extra.length) reject(`new_line_key has non-key column${extra.length > 1 ? 's' : ''} ${extra.join(', ')}`)
          const m = String(l.measure_column ?? '')
          if (!book.measureColumns.includes(m))
            reject(`"${m}" is not a declared measure of ${book.name}`)
          if (l.proposed_value == null || l.proposed_value === '')
            reject('proposed_value is required')
          dedupe(`${keySignature(key, book.keyColumns)}\u0000${m}`, 'measure for the same new line')
          if (await keyCollides(tx, book, key))
            reject(`a ${book.refTable} row with that key already exists — revise it instead`)
          l.current_value = 0
          l.delta = num(l.proposed_value)
        } else if (type === 'discontinue') {
          if (!ref) reject('a discontinue line names the row to discontinue via line_ref')
          if (l.measure_column != null && l.measure_column !== '')
            reject('discontinue lines zero every measure from effective_from — leave measure_column empty')
          dedupe(ref!, 'line')
          const live = await liveRow(ref!)
          // BUD-R8 (audit bug #2): a second discontinue would silently
          // re-zero the periods that stood as the wind-down yardstick.
          if (live[DISCONTINUED_FLAG] === true)
            reject(`${ref} is already discontinued — reinstate it with a revise first`)
          collectOwner(live)
          const fromIdx = book.measureColumns.indexOf(effective!)
          const cur = book.measureColumns.slice(fromIdx).reduce((s, c) => s + num(live[c]), 0)
          guardObservation(ref!, `${effective!}…`, l, cur)
          l.current_value = cur
          l.proposed_value = 0
          l.delta = -cur
        } else if (type === 'revise' || type === 'transfer') {
          if (!ref) reject('line_ref is required')
          const m = String(l.measure_column ?? '')
          if (!book.measureColumns.includes(m))
            reject(`"${m}" is not a declared measure of ${book.name}`)
          if (l.proposed_value == null || l.proposed_value === '')
            reject('proposed_value is required')
          dedupe(`${ref}\u0000${m}`, 'cell')
          const live = await liveRow(ref!)
          collectOwner(live)
          const cur = num(live[m])
          guardObservation(ref!, m, l, cur)
          l.current_value = cur
          l.delta = num(l.proposed_value) - cur
        } else {
          reject(`unknown change_type "${type}"`)
        }
        total += num(l.delta)
      }

      // BUD-R6: money moves, none is created. (Rounded: measures are read
      // back from double-precision storage.)
      if (type === 'transfer' && Math.abs(total) > 1e-9)
        reject(`a transfer must net to zero (currently ${total > 0 ? '+' : ''}${total})`)

      row.total_delta = total
      row.crosses_owner = owners.size > 1
      row.over_doa = overDoa(book, total)
    },

    // BUD-R5: approval applies — inside the submit transaction, so a failing
    // line aborts the status change with it (BUD-I2). setStatus and the
    // workflow-transition path both fire this hook.
    before_submit: async (ctx) => {
      const book = await requireBook(ctx)
      const lines = await loadStoredLines(ctx)
      if (!lines.length) reject('a Budget Change needs at least one line')
      await applyChange(ctx.tx, ctx.row, lines, book, ctx.user)
    },

    // BUD-R9: an applied change is history; the road back is a new change.
    before_cancel: ({ row }) => {
      reject(
        `${String(row.row_id)} has been applied and cannot be cancelled — propose an opposite Budget Change instead`,
      )
    },
  },
}

export default controller
