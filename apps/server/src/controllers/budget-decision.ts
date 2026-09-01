import { AppError } from '../errors'
import type { TableController } from '../controllers'
import { DECISION } from '../budget'

// Spec 0007, BUD-R16: the decision ledger is append-only. A decision records
// a judgment somebody made at a moment, against a stated model version — so
// editing one would rewrite history, and deleting one would remove the very
// entry a later grading pass needs (the superseded decision IS the data).
//
// The road back is another decision, exactly as BUD-R9 for changes. Rows are
// written by the engine inside an approval (BUD-R14); nothing else may
// create them either, or the ledger would carry entries no approval stands
// behind.
const controller: TableController = {
  table: DECISION,
  hooks: {
    validate: (ctx) => {
      if (!ctx.isNew)
        throw new AppError(
          'ValidationError',
          `${DECISION} rows are append-only — a decision is a record of what someone judged, and the road back is another decision`,
        )
    },
    on_trash: () => {
      throw new AppError(
        'ValidationError',
        `${DECISION} rows are never deleted — a superseded decision is still evidence`,
      )
    },
  },
}

export default controller
