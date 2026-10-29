// #629: the glossary. An app ships its terms in its manifest (`glossary`, an
// extension point with its own version); installing or upgrading the app
// writes them as Glossary Term rows under the app. An instance may add its
// own terms (no app) and reword an app's. A term the instance reworded keeps
// its wording through every upgrade; when the app's own wording changes, the
// row says so, and an editor may take the app's wording instead.
//
// Whether a term is reworded is never stored: it is the row's wording
// compared with the app's wording as last shipped. Whether a term shows is
// never stored either: an app's term shows while its app is installed,
// turned on, and still declares it, so a removed app's terms (and the
// instance's rewording of them) come back with the app.
import { z } from 'zod'
import { sql, withTransaction } from './db'
import { saveDoc } from './document'
import { AppError } from './errors'
import { hasPermission } from './permissions'
import { activeApps } from './app-lifecycle'
import { canonical } from './runtime-migrations'

const text = z.string().trim().min(1)

export const glossaryDeclaration = z.object({
  version: z.literal(1),
  terms: z.array(z.object({
    term: text.max(140),
    definition: text,
    // One line each: the row keeps them one per line.
    examples: z.array(text.regex(/^[^\r\n]*$/, 'An example is one line')).optional(),
    avoid: z.array(z.object({ word: text.max(140), reason: text.max(140).optional() }).strict()).optional(),
    describes: z.array(z.object({ table: text, column: text.optional() }).strict()).optional(),
  }).strict()),
}).strict().refine(g => new Set(g.terms.map(t => t.term.toLocaleLowerCase())).size === g.terms.length, 'Each glossary term is declared once')

type Declaration = z.infer<typeof glossaryDeclaration>
type DeclaredTerm = Declaration['terms'][number]

/** A term's wording: everything the instance may reword. */
interface Wording {
  term: string
  definition: string
  examples: string[]
  avoid: { word: string; reason: string | null }[]
  describes: { table: string; column: string | null }[]
}

/** Refuse a term that describes a Table the app neither owns nor declares
 *  (in its grants), or a column the app's own Table does not have. Checked
 *  when the app is loaded, so the app is refused before it can install. */
export function validateGlossary(
  glossary: Declaration | undefined,
  tables: readonly { name: string; columns: readonly { column_name: string }[] }[],
  permissions: readonly { table: string }[],
) {
  for (const { term, describes } of glossary?.terms ?? []) {
    for (const { table, column } of describes ?? []) {
      const owned = tables.find(t => t.name === table)
      const declared = owned || permissions.some(p => p.table === table)
      if (!declared || (column !== undefined && !owned?.columns.some(c => c.column_name === column)))
        throw new Error(`The glossary term ${term} describes ${column === undefined ? table : `${table}.${column}`}, which the app does not own or declare`)
    }
  }
}

function shipped(term: DeclaredTerm): Wording {
  return {
    term: term.term,
    definition: term.definition,
    examples: term.examples ?? [],
    avoid: (term.avoid ?? []).map(a => ({ word: a.word, reason: a.reason ?? null })),
    describes: (term.describes ?? []).map(d => ({ table: d.table, column: d.column ?? null })),
  }
}

/** The values a save writes for a wording. */
function asRow(wording: Wording) {
  return {
    term: wording.term,
    definition: wording.definition,
    examples: wording.examples.join('\n') || null,
    avoid: wording.avoid.map(a => ({ word: a.word, reason: a.reason })),
    describes: wording.describes.map(d => ({ link_table: d.table, link_column: d.column })),
  }
}

const blank = (value: unknown) => value == null || String(value).trim() === ''

async function wordingsOf(ids: string[], db: typeof sql = sql): Promise<Map<string, Wording>> {
  const result = new Map<string, Wording>()
  if (!ids.length) return result
  const rows = await db`select row_id, term, definition, examples from glossary_term where row_id in ${sql(ids)}`
  const avoid = await db`select parent, word, reason from glossary_avoid_word
    where parenttype = 'Glossary Term' and parent in ${sql(ids)} order by parent, position`
  const links = await db`select parent, link_table, link_column from glossary_link
    where parenttype = 'Glossary Term' and parent in ${sql(ids)} order by parent, position`
  for (const row of rows) {
    const id = String(row.row_id)
    result.set(id, {
      term: String(row.term ?? ''),
      definition: String(row.definition ?? ''),
      examples: String(row.examples ?? '').split('\n').map(line => line.trim()).filter(Boolean),
      avoid: avoid.filter(a => a.parent === id).map(a => ({ word: String(a.word), reason: blank(a.reason) ? null : String(a.reason) })),
      describes: links.filter(l => l.parent === id).map(l => ({ table: String(l.link_table), column: blank(l.link_column) ? null : String(l.link_column) })),
    })
  }
  return result
}

/** Install and upgrade: write `app`'s declared terms. A term new to this
 *  instance is added; one the instance has not reworded takes the app's new
 *  wording; one it has reworded keeps its wording, and is marked when the
 *  app's wording changed. A term the app stopped declaring stays stored (and
 *  hidden), so declaring it again brings back the instance's wording. */
export async function syncAppGlossary(app: string, glossary: Declaration | undefined, actor: string) {
  const declared = glossary?.terms ?? []
  if (!declared.length) return
  const existing = await sql`select row_id, app_key, app_wording, updated_at from glossary_term where app = ${app}`
  const current = await wordingsOf(existing.map(row => String(row.row_id)))
  for (const term of declared) {
    const wording = shipped(term)
    const row = existing.find(r => r.app_key === term.term)
    if (!row) {
      const saved = await saveDoc('Glossary Term', asRow(wording), actor, 'insert')
      await sql`update glossary_term set app = ${app}, app_key = ${term.term},
        app_wording = ${sql.json(wording as never)}, app_wording_changed = false where row_id = ${String(saved.row_id)}`
      continue
    }
    const id = String(row.row_id)
    const reworded = canonical(current.get(id)) !== canonical(row.app_wording)
    if (canonical(row.app_wording) === canonical(wording)) continue
    if (!reworded) await saveDoc('Glossary Term', { row_id: id, updated_at: row.updated_at, ...asRow(wording) }, actor)
    await sql`update glossary_term set app_wording = ${sql.json(wording as never)},
      app_wording_changed = ${reworded} where row_id = ${id}`
  }
}

/** Replace a reworded app term's wording with the app's. Saved as `user`,
 *  so it needs the same write grant as any edit. */
export async function takeAppWording(id: string, user: string) {
  const [row] = await sql`select app_wording, updated_at from glossary_term where row_id = ${id}`
  if (!row) throw new AppError('NotFoundError', `Glossary Term ${id} not found`)
  if (!row.app_wording) throw new AppError('ValidationError', 'This term belongs to the instance; it has no app wording to take')
  await withTransaction(() => saveDoc('Glossary Term', { row_id: id, updated_at: row.updated_at, ...asRow(row.app_wording as Wording) }, user))
}

/** After any save of a term: once its wording is the app's again, the mark
 *  that the app's wording changed has been dealt with, and goes. Runs on the
 *  save's own transaction `tx`: it must read what the save wrote, and update
 *  the row the save holds locked. */
export async function settleAppWordingMark(id: string, tx: typeof sql) {
  const [row] = await tx`select app_wording from glossary_term where row_id = ${id} and app_wording_changed`
  if (row && canonical((await wordingsOf([id], tx)).get(id)) === canonical(row.app_wording))
    await tx`update glossary_term set app_wording_changed = false where row_id = ${id}`
}

/** Everything the glossary shows `user`: the terms of every installed,
 *  turned-on app that still declares them, by app title, then the instance's
 *  own; each in term order. */
export async function readGlossary(user: string) {
  if (!(await hasPermission(user, 'Glossary Term', 'read')))
    throw new AppError('PermissionError', 'Not permitted to read the glossary')
  const apps = new Map((await sql`select name, manifest from installed_app
      where enabled and not activation_pending`)
    .filter(row => activeApps.has(String(row.name)))
    .map(row => {
      const manifest = (row.manifest ?? {}) as { title?: string; glossary?: Declaration }
      return [String(row.name), { title: manifest.title ?? String(row.name), keys: new Set((manifest.glossary?.terms ?? []).map(t => t.term)) }] as const
    }))
  const rows = (await sql`select row_id, app, app_key, app_wording, app_wording_changed from glossary_term`)
    .filter(row => row.app == null || apps.get(String(row.app))?.keys.has(String(row.app_key)))
  const wordings = await wordingsOf(rows.map(row => String(row.row_id)))
  // A described column is shown by its label, as forms show it.
  const tables = [...new Set([...wordings.values()].flatMap(w => w.describes.filter(d => d.column).map(d => d.table)))]
  const labels = new Map((tables.length ? await sql`select parent, column_name, label from column_def where parent in ${sql(tables)}` : [])
    .map(c => [`${String(c.parent)}\u0000${String(c.column_name)}`, c.label == null ? null : String(c.label)]))
  const terms = rows.map((row) => {
    const wording = wordings.get(String(row.row_id))!
    const app = row.app == null ? null : String(row.app)
    const editedHere = app !== null && canonical(wording) !== canonical(row.app_wording)
    const describes = wording.describes.map(d => ({ ...d, columnLabel: d.column && (labels.get(`${d.table}\u0000${d.column}`) ?? d.column) }))
    return { id: String(row.row_id), ...wording, describes, app, appTitle: app && apps.get(app)!.title,
      editedHere, appWordingChanged: editedHere && row.app_wording_changed === true }
  })
  // The instance's own terms come after every app's.
  terms.sort((a, b) => Number(a.appTitle === null) - Number(b.appTitle === null) ||
    (a.appTitle ?? '').localeCompare(b.appTitle ?? '') || a.term.localeCompare(b.term))
  return { canEdit: await hasPermission(user, 'Glossary Term', 'write'), canAdd: await hasPermission(user, 'Glossary Term', 'create'), terms }
}
