import { whyAnswerSchema, type WhyAnswer, type WhyExplained, type WhyOffer } from 'shared'
import { withAppIdentity } from './app-lifecycle'
import { getDoc } from './document'
import { AppError } from './errors'
import { rowTitles } from './row-titles'
import { runPackageRead, whyDeclarationFor } from './runtime-packages'

// #1282 Why mode (E6–E7, decision of 18-Nov-2026): the record Map's Why view is an
// installed app's explanation of one record, declared in its manifest's `why`.
// Every decision is the server's: the viewer must read the record itself, the
// app must say (by its `may` read, run as the viewer) that this viewer may have
// it explained, the answer must be the one versioned shape, and no box names a
// record the viewer may not read. Both are reads, so explaining writes nothing.

/** What a box says for a record the viewer may not read (as the Map and the path do). */
const UNSEEN_ROW = 'A row you cannot see'

type Declaration = NonNullable<Awaited<ReturnType<typeof whyDeclarationFor>>>

/** One of the app's reads, as the viewer, about this record. */
function read(declaration: Declaration, name: string, table: string, row: string, user: string) {
  return withAppIdentity(declaration.app, declaration.version, () =>
    runPackageRead(declaration.app, name, { payload: { table, row } }, user)) as Promise<{ result?: unknown }>
}

/** Whether the app lets `user` have this record explained: only exactly true does, and any failure does not. */
async function mayExplain(declaration: Declaration, table: string, row: string, user: string): Promise<boolean> {
  try {
    return (await read(declaration, declaration.may, table, row, user))?.result === true
  } catch {
    return false
  }
}

/** The app explaining this record for `user`, or none. The viewer must read the record first. */
async function explainer(table: string, row: string, user: string): Promise<Declaration | null> {
  await getDoc(table, row, user)
  const declaration = await whyDeclarationFor(table, user)
  return declaration && await mayExplain(declaration, table, row, user) ? declaration : null
}

/** GET /api/why/:table/:row: whether the Map offers Why for this record, and its words. */
export async function whyOffer(table: string, row: string, user: string): Promise<WhyOffer> {
  const declaration = await explainer(table, row, user)
  return { offer: declaration ? { label: declaration.label } : null }
}

/** GET /api/why/:table/:row/explain: the app's explanation, checked, its records scrubbed for `user`. */
export async function explainRecord(table: string, row: string, user: string): Promise<WhyExplained> {
  const declaration = await explainer(table, row, user)
  if (!declaration) throw new AppError('PermissionError', 'This record has no explanation you may see')
  const answer = (await read(declaration, declaration.explain, table, row, user))?.result
  const parsed = whyAnswerSchema.safeParse(answer)
  // Refused whole, saying nothing of what the app sent.
  if (!parsed.success) throw new AppError('DataSourceError', "The app's explanation is not one the Map can draw")
  return { label: declaration.label, answer: await scrubbed(parsed.data, user) }
}

/**
 * The answer as the viewer gets it: every record the viewer may not read named neutrally, with no record to
 * open, and every box known by an opaque id of the platform's own (b1, b2, …), its edges rewritten to match. An
 * app's ids may carry the very record ids being hidden (Codex adversarial, round 1), so none of them leaves.
 */
async function scrubbed(answer: WhyAnswer, user: string): Promise<WhyAnswer> {
  const refs = answer.columns.flatMap((c) => c.boxes.flatMap((b) => b.record ? [{ table: b.record.table, row_id: b.record.row }] : []))
  const readable = new Set((await rowTitles(user, refs)).map((t) => `${t.table}\u0000${t.row_id}`))
  const opaque = new Map(answer.columns.flatMap((c) => c.boxes).map((b, i) => [b.id, `b${i + 1}`]))
  return {
    version: answer.version,
    columns: answer.columns.map((c) => ({
      heading: c.heading,
      boxes: c.boxes.map((b) => !b.record || readable.has(`${b.record.table}\u0000${b.record.row}`)
        ? { ...b, id: opaque.get(b.id)! }
        : { id: opaque.get(b.id)!, name: UNSEEN_ROW }),
    })),
    edges: answer.edges.map(([from, to]) => [opaque.get(from)!, opaque.get(to)!]),
  }
}
