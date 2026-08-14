import { AppError } from '../errors'
import type { HookContext, TableController } from '../controllers'
import { tableName } from '../table-engine'
import type { RowValues } from '../document'
import { BOOK, validateBinding } from '../budget'

// Spec 0007, BUD-R1/R2: a Budget Book's declaration is validated on every
// save; its lifecycle moves only through the :baseline/:close actions
// (which write directly, bypassing this hook on purpose); once baselined,
// the definition is frozen.

// Child columns arrive in the payload when sent; an update that omitted
// them means "unchanged" — read the stored rows so validation always sees
// the full declaration.
async function childColumns(
  ctx: HookContext,
  columnName: string,
  childTable: string,
): Promise<string[]> {
  const sent = ctx.row[columnName]
  if (Array.isArray(sent))
    return sent.map((r) => String((r as RowValues).column_name ?? '')).filter(Boolean)
  if (ctx.isNew) return []
  const rows = await ctx.tx`
    select column_name from ${ctx.tx(tableName(childTable))}
    where parent = ${String(ctx.row.row_id)} and parenttype = ${BOOK} order by position`
  return rows.map((r) => String(r.column_name))
}

const controller: TableController = {
  table: BOOK,
  hooks: {
    validate: async (ctx) => {
      const { row, old, isNew, tx } = ctx
      if (isNew) {
        // A book is born working — nobody smuggles in a later lifecycle.
        row.lifecycle = 'working'
      } else {
        if (String(row.lifecycle ?? '') !== String(old!.lifecycle ?? ''))
          throw new AppError(
            'ValidationError',
            'lifecycle changes only through the :baseline and :close actions',
          )
        if (String(old!.lifecycle) !== 'working')
          throw new AppError(
            'ValidationError',
            `${String(row.row_id)} is ${String(old!.lifecycle)} — a book's definition is frozen once baselined`,
          )
      }
      await validateBinding({
        refTable: String(row.ref_table ?? ''),
        ownerColumn: row.owner_column ? String(row.owner_column) : null,
        keyColumns: await childColumns(ctx, 'key_columns', 'Budget Book Key Column'),
        measureColumns: await childColumns(ctx, 'measure_columns', 'Budget Book Measure Column'),
      })
      // BUD-R1: at most one non-closed book per bound table — the write-lock
      // must never be ambiguous.
      const [dupe] = await tx`
        select row_id from ${tx(tableName(BOOK))}
        where ref_table = ${String(row.ref_table)} and lifecycle <> 'closed'
          and row_id <> ${String(row.row_id ?? '')} limit 1`
      if (dupe)
        throw new AppError(
          'ValidationError',
          `${String(row.ref_table)} is already governed by ${String(dupe.row_id)} — close it first`,
        )
    },
    on_trash: ({ row }) => {
      if (String(row.lifecycle) === 'active')
        throw new AppError(
          'ValidationError',
          `${String(row.row_id)} is active and cannot be deleted — close it first`,
        )
    },
  },
}

export default controller
