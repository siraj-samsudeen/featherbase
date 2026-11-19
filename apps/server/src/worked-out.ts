import { workedOutSchema, type WorkedOut, type WorkedOutAnswer } from 'shared'
import { withAppIdentity } from './app-lifecycle'
import { getDoc } from './document'
import { AppError } from './errors'
import { rowTitles } from './row-titles'
import { runPackageRead, workedOutDeclarationFor } from './runtime-packages'

// #1282 C10–C11 (UI owner, option A): the record panel's worked-out sections ("Apps They Can Open ·
// worked out from their roles") are an installed app's answer about one record, declared in its
// manifest's `workedOut`. Every decision is the server's, as for Why: the viewer must read the record
// itself and pass the app's own gate; the app's read, run as the viewer, decides what it shows (an app
// may show nothing, or sections without the why); the answer must be the one versioned shape; and no
// row names a record the viewer may not read.

/** What a row says for a record the viewer may not read (as the Map and Why do). */
const UNSEEN_ROW = 'A row you cannot see'

const NONE: WorkedOutAnswer = { sections: [] }

/** GET /api/worked-out/:table/:row: the sections an app works out about this record, for `user`; none where no app does. */
export async function workedOutFor(table: string, row: string, user: string): Promise<WorkedOutAnswer> {
  await getDoc(table, row, user)
  const declaration = await workedOutDeclarationFor(table, user)
  if (!declaration) return NONE
  const answer = (await withAppIdentity(declaration.app, declaration.version, () =>
    runPackageRead(declaration.app, declaration.read, { payload: { table, row } }, user)) as { result?: unknown })?.result
  // The app shows nothing to this viewer.
  if (answer === null || answer === undefined) return NONE
  const parsed = workedOutSchema.safeParse(answer)
  // Refused whole, saying nothing of what the app sent.
  if (!parsed.success) throw new AppError('DataSourceError', "The app's worked-out sections are not ones the record panel can draw")
  return { sections: await scrubbed(parsed.data, user) }
}

/**
 * The sections as the viewer gets them: a row naming a record the viewer may not read is named neutrally, with no
 * record, no via and no why; a via naming one is named neutrally too, without its record; a why naming one is
 * left out whole, so its chain never names a record the viewer may not read.
 */
async function scrubbed(answer: WorkedOut, user: string): Promise<WorkedOut['sections']> {
  const rows = answer.sections.flatMap((s) => s.rows)
  const named = rows.flatMap((r) => [...(r.record ? [r.record] : []), ...r.via.flatMap((v) => v.record ? [v.record] : []),
    ...(r.why ?? []).flatMap((p) => [p, ...(p.detailParts ?? [])].flatMap((q) => q.record ? [q.record] : []))])
  const readable = new Set((await rowTitles(user, named.map((r) => ({ table: r.table, row_id: r.row }))))
    .map((t) => `${t.table}\u0000${t.row_id}`))
  const reads = (r?: { table: string; row: string }) => !r || readable.has(`${r.table}\u0000${r.row}`)
  return answer.sections.map((section) => ({
    ...section,
    rows: section.rows.map((r) => {
      if (!reads(r.record)) return { name: UNSEEN_ROW, via: [] }
      const via = r.via.map((v) => (reads(v.record) ? v : { name: UNSEEN_ROW }))
      // A chain naming any record the viewer may not read, its areas' parts included, is left out whole.
      const why = r.why && r.why.every((p) => reads(p.record) && (p.detailParts ?? []).every((q) => reads(q.record))) ? { why: r.why } : {}
      const { why: _dropped, ...rest } = r
      return { ...rest, via, ...why }
    }),
  }))
}
