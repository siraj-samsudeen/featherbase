import { RECORD_FACTS_LIMITS, actionPreviewSchema, recordFactsSchema, type ActionPreview, type ActionPreviewAnswer, type RecordFacts, type RecordFactsAnswer } from 'shared'
import { withAppIdentity } from './app-lifecycle'
import { AppError } from './errors'
import { getMeta } from './meta'
import { hasPermission } from './permissions'
import { rowTitles } from './row-titles'
import { recordsDeclarationFor, runPackageRead } from './runtime-packages'

// #1340: an installed app describes rows of a Table it declares in its manifest's `records`, by one of its reads,
// run as the viewer. Every decision is the server's, as for a Why (#1282): the viewer must read the Table, and only
// rows they may read are described; the answer must be the one versioned shape; and no record the viewer may not read
// is named. Any failure of the app's read is no facts at all: the generic page is drawn as it was.

const UNSEEN_ROW = 'A row you cannot see'

type Declaration = NonNullable<Awaited<ReturnType<typeof recordsDeclarationFor>>>
type Part = string | { record: { table: string; row: string; name: string } } | { chip: string }

function read(declaration: Declaration, name: string, payload: Record<string, unknown>, user: string) {
  return withAppIdentity(declaration.app, declaration.version, () =>
    runPackageRead(declaration.app, name, { payload }, user)) as Promise<{ result?: unknown }>
}

/** The rows of `table` among `rows` that `user` may read: an unreadable one is never described. */
async function readable(table: string, rows: string[], user: string): Promise<string[]> {
  const titles = await rowTitles(user, rows.map((row_id) => ({ table, row_id })))
  const seen = new Set(titles.map((t) => t.row_id))
  return rows.filter((r) => seen.has(r))
}

/** Every record a set of sentences names, as the viewer may read them. */
async function readableRecords(parts: Part[], user: string): Promise<Set<string>> {
  const named = parts.flatMap((p) => typeof p === 'object' && 'record' in p ? [p.record] : [])
  if (!named.length) return new Set()
  const titles = await rowTitles(user, named.map((r) => ({ table: r.table, row_id: r.row })))
  return new Set(titles.map((t) => `${t.table}\u0000${t.row_id}`))
}

const scrub = (reads: Set<string>) => (part: Part): Part =>
  typeof part === 'object' && 'record' in part && !reads.has(`${part.record.table}\u0000${part.record.row}`) ? UNSEEN_ROW : part

/** All the sentence parts in an answer, to check every record they name at once. */
function partsOf(facts: RecordFacts): Part[] {
  return Object.values(facts.rows).flatMap((row) => (row.groups ?? []).flatMap((g) => [
    ...Object.values(g.rows ?? {}), ...(g.lines ?? []),
  ].flatMap((line) => [...line.parts, ...(line.note ?? [])])))
}

/**
 * Which keys of the groups' `rows` and `notes` name records `user` may read: a row of the group's Table, or for a
 * note, a row of a Table the group's links point at (other than the described Table itself, the back link).
 */
async function readableKeys(table: string, groups: { table?: string; rows?: Record<string, unknown>; notes?: Record<string, string> }[], user: string): Promise<Set<string>> {
  const keep = new Set<string>()
  for (const g of groups) {
    if (!g.table) continue
    const rows = Object.keys(g.rows ?? {})
    if (rows.length) for (const t of await rowTitles(user, rows.map((row_id) => ({ table: g.table!, row_id })))) keep.add(`${g.table}\u0000${t.row_id}`)
    const notes = Object.keys(g.notes ?? {})
    if (!notes.length) continue
    // A Table that is not there points at nothing: its notes are left out.
    const meta = await getMeta(g.table).catch(() => ({ columns: [] as { column_type: string; reference_table?: string | null }[] }))
    const far = meta.columns.flatMap((c) => c.column_type === 'Reference' && c.reference_table && c.reference_table !== table ? [c.reference_table] : [])
    for (const t of await rowTitles(user, far.flatMap((ft) => notes.map((row_id) => ({ table: ft, row_id }))))) keep.add(`note:${g.table}\u0000${t.row_id}`)
  }
  return keep
}

/** POST /api/records/:table/describe { rows, page }: the app's facts about those rows, for `user`, or none. */
export async function describeRows(table: string, body: unknown, user: string): Promise<RecordFactsAnswer | { facts: null }> {
  const asked = body && typeof body === 'object' ? body as { rows?: unknown; page?: unknown } : {}
  const rows = Array.isArray(asked.rows) ? [...new Set(asked.rows.filter((r): r is string => typeof r === 'string' && r.length > 0 && r.length <= 200))] : []
  if (rows.length > RECORD_FACTS_LIMITS.rows) throw new AppError('ValidationError', `Describe at most ${RECORD_FACTS_LIMITS.rows} rows at once`)
  const page = asked.page === true
  // A record page asks about its one row.
  if (page && rows.length !== 1) throw new AppError('ValidationError', 'A record page asks about one row')
  if (!(await hasPermission(user, table, 'read'))) throw new AppError('PermissionError', 'You may not read this Table')
  const declaration = await recordsDeclarationFor(table, user)
  if (!declaration?.describe) return { facts: null }
  const describe = declaration.describe
  const shown = await readable(table, rows, user)
  let answer: unknown
  try {
    answer = (await read(declaration, describe, { table, rows: shown, page }, user))?.result
  } catch {
    // Refused, or failed: the page draws as it does with no app.
    return { facts: null }
  }
  const parsed = recordFactsSchema.safeParse(answer)
  if (!parsed.success) return { facts: null }
  const facts = parsed.data
  const allowed = new Set(shown)
  const reads = await readableRecords(partsOf(facts), user)
  const line = <L extends { parts: Part[]; note?: Part[] }>(l: L): L => ({ ...l, parts: l.parts.map(scrub(reads)), ...(l.note && { note: l.note.map(scrub(reads)) }) })
  // Codex standard round 1: a group's row, or a note's far-side record, the viewer may not read never leaves, id and all.
  const groups = page ? Object.values(facts.rows).flatMap((row) => row.groups ?? []) : []
  const keep = await readableKeys(table, groups, user)
  return {
    app: declaration.app,
    version: declaration.version,
    facts: {
      ...facts,
      // Only the rows asked about and readable, and groups only on a record page.
      rows: Object.fromEntries(Object.entries(facts.rows).filter(([id]) => allowed.has(id)).map(([id, row]) => [id, {
        ...row,
        groups: page ? row.groups?.map((g) => ({
          ...g,
          ...(g.rows && { rows: Object.fromEntries(Object.entries(g.rows).filter(([r]) => keep.has(`${g.table}\u0000${r}`)).map(([r, l]) => [r, line(l)])) }),
          ...(g.notes && { notes: Object.fromEntries(Object.entries(g.notes).filter(([r]) => keep.has(`note:${g.table}\u0000${r}`))) }),
          ...(g.lines && { lines: g.lines.map(line) }),
        })) : undefined,
      }])),
    },
  }
}

/** GET /api/records/:table/preview/:action: what the app's action would do, said by its preview read, writing nothing. */
export async function previewAction(table: string, action: string, user: string): Promise<ActionPreviewAnswer> {
  if (!(await hasPermission(user, table, 'read'))) throw new AppError('PermissionError', 'You may not read this Table')
  const declaration = await recordsDeclarationFor(table, user)
  const previewRead = declaration && Object.hasOwn(declaration.previews, action) ? declaration.previews[action]! : null
  if (!declaration || !previewRead) throw new AppError('NotFoundError', 'There is no preview of this action')
  // The app's own refusal is said in its own words.
  const answer = (await read(declaration, previewRead, { table }, user))?.result
  const parsed = actionPreviewSchema.safeParse(answer)
  if (!parsed.success) throw new AppError('DataSourceError', "The app's preview is not one this page can draw")
  const preview: ActionPreview = parsed.data
  const cellParts = preview.rows.flatMap((r) => Object.values(r.cells).flatMap((c) => 'parts' in c ? c.parts : []))
  const reads = await readableRecords([...preview.sentence, ...cellParts], user)
  return {
    app: declaration.app,
    version: declaration.version,
    label: preview.title,
    preview: {
      ...preview,
      sentence: preview.sentence.map(scrub(reads)),
      rows: preview.rows.map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, 'parts' in c ? { parts: c.parts.map(scrub(reads)) } : c])) })),
    },
  }
}
