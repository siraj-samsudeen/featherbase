import { AppError } from '../errors'
import { WILDCARD_TABLE, type HookContext, type TableController } from '../controllers'
import { activeBookFor, declaredColumns, type BookBinding } from '../budget'

// Spec 0007, BUD-R3: while a Budget Book is active, its bound table accepts
// no direct row writes — inserts and deletes are refused outright, and
// updates touching a declared column (key, measure, owner, or the engine's
// discontinued flag) are refused whole-write. Undeclared columns (notes,
// attachments) stay editable. The engine's own apply path writes bound rows
// directly inside its transaction and never passes through these hooks, so
// no bypass flag exists — there is nothing to forget to check.

async function governingBook(ctx: HookContext): Promise<BookBinding | null> {
  if (ctx.meta.kind !== 'table' || ctx.meta.system) return null
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
