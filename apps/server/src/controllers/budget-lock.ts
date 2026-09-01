import { AppError } from '../errors'
import { WILDCARD_TABLE, type HookContext, type TableController } from '../controllers'
import { ENGINE_APPLY, activeBookFor, declaredColumns, type BookBinding } from '../budget'

// Spec 0007, BUD-R3: while a Budget Book is active, its bound table accepts
// no direct row writes — inserts and deletes are refused outright, and
// updates touching a declared column (key, measure, owner, or the engine's
// discontinued flag) are refused whole-write. Undeclared columns (notes,
// attachments) stay editable.
//
// The engine's own apply DOES pass through here now (it writes bound rows
// through saveDoc so their validation, hooks and Document Event Scripts run),
// and is recognised by the ENGINE_APPLY capability rather than by a flag on
// the row. The capability can only be set by an in-process caller — it never
// travels in a request body — so a client cannot ask for it.

async function governingBook(ctx: HookContext): Promise<BookBinding | null> {
  if (ctx.meta.kind !== 'table' || ctx.meta.system) return null
  // The engine's own apply carries ENGINE_APPLY, so an approved Budget
  // Change writes bound rows through this same lifecycle instead of around
  // it (raw SQL used to skip validation, hooks and Document Event Scripts
  // entirely). The capability opens THIS gate only — everything else on the
  // save path still judges the row.
  if (ctx.capabilities?.has(ENGINE_APPLY)) return null
  return activeBookFor(ctx.tx, ctx.meta.name)
}

// The same normalization recordVersion diffs with: a value is "changed"
// when its JSON image differs.
const norm = (v: unknown) => JSON.stringify(v instanceof Date ? v.toISOString() : (v ?? null))

const controller: TableController = {
  table: WILDCARD_TABLE,
  hooks: {
    validate: async (ctx) => {
      const book = await governingBook(ctx)
      if (!book) return
      if (ctx.isNew)
        throw new AppError(
          'ValidationError',
          `${book.name} is active — new ${ctx.meta.name} rows are born through a Budget Change (new_line); a whole file goes through :import_proposal`,
        )
      for (const c of declaredColumns(book)) {
        if (norm(ctx.row[c]) !== norm(ctx.old?.[c]))
          throw new AppError(
            'ValidationError',
            `${book.name} is active — changes to "${c}" go through a Budget Change; a whole file goes through :import_proposal`,
          )
      }
    },
    on_trash: async (ctx) => {
      const book = await governingBook(ctx)
      if (book)
        throw new AppError(
          'ValidationError',
          `${book.name} is active — rows are never deleted from a governed budget; discontinue instead`,
        )
    },
  },
}

export default controller
