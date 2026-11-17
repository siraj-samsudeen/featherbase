// #1223 (Siraj, 16-Nov): every record shown is a link to its record, on every screen. Dash draws them
// with the shared RecordLink (#1227, packages/shop-floor): one look, and one rule for where a record
// opens (an app's own page for it, else its Featherbase record). A record the viewer may not open is
// the same words as plain text: a Dash Reader manager sees their area through Dash's own reads, but may
// hold no grant on the Featherbase Tables behind it, so a link would only lead to a refusal.
import { useEffect, useState, type ReactNode } from 'react'
import { RecordLink as SharedRecordLink, useRecordHref } from '@featherbase/shop-floor'
import { read } from './api'

/** The Table names Dash links to, as Featherbase knows them. */
export const RECORD = {
  site: 'Site', floor: 'Store Floor', section: 'Section', employee: 'Employee', department: 'Department',
  subcategory: 'Subcategory', category: 'Category', region: 'Operating Region', merchandise: 'Merchandise Assignment', buyerSection: 'Buyer Section',
  // #1225: what Report access shows.
  report: 'dash.report', bundle: 'dash.report_bundle', role: 'Role', job: 'Job',
} as const

/** Whether the signed-in person may open a Table's records in Featherbase: its description answers only
 *  someone who may read it. Asked once per Table per page; unknown (or failed) counts as no. */
const opens = new Map<string, Promise<boolean>>()
export function canOpenTable(table: string): Promise<boolean> {
  let answer = opens.get(table)
  if (!answer) {
    answer = Promise.resolve().then(() => fetch(`/api/table/${encodeURIComponent(table)}:meta`, { credentials: 'same-origin' })).then(r => r.ok, () => false)
    opens.set(table, answer)
  }
  return answer
}

/** Whether the viewer may open one record on Dash's own page, asked of the server by the destination's own
 *  rules (dash_pages_open): a page's questions are gathered for one turn and asked together, once each. */
const pageAnswers = new Map<string, Promise<boolean>>()
let pending: { table: string; id: string; settle: (ok: boolean) => void }[] = []
function flush() {
  const batch = pending; pending = []
  for (let i = 0; i < batch.length; i += 200) {
    const part = batch.slice(i, i + 200)
    read<boolean[]>('dash_pages_open', { refs: part.map(({ table, id }) => ({ table, id })) })
      .then(answers => part.forEach((p, k) => p.settle(answers[k] === true)), () => part.forEach(p => p.settle(false)))
  }
}
export function canOpenPage(table: string, id: string): Promise<boolean> {
  const key = `${table}|${id}`
  let answer = pageAnswers.get(key)
  if (!answer) {
    answer = new Promise<boolean>(settle => { if (!pending.length) queueMicrotask(flush); pending.push({ table, id, settle }) })
    pageAnswers.set(key, answer)
  }
  return answer
}

function useCanOpen(table: string, id: string | null | undefined): boolean {
  const [can, setCan] = useState(false)
  useEffect(() => {
    if (!id) return
    let live = true
    void (table in DASH_PAGES ? canOpenPage(table, id) : canOpenTable(table)).then(ok => { if (live) setCan(ok) })
    return () => { live = false }
  }, [table, id])
  return can
}

/** #1223: the records Dash has a page of its own for; each link asks whether this viewer may open it there. */
export const DASH_PAGES: Readonly<Record<string, (id: string) => string>> = {
  Employee: id => `?view=coverage&employee=${encodeURIComponent(id)}`,
  Department: id => `?view=coverage&department=${encodeURIComponent(id)}`,
  Section: id => `?view=coverage&section=${encodeURIComponent(id)}`,
}
/** For RecordPagesProvider: a Dash page for the record, else undefined (its Featherbase record). */
export const dashPageFor = (table: string, id: string) => DASH_PAGES[table]?.(id)

/** A record as a link to it; plain text when there is no record, or the viewer may not open it. A text
 *  label goes to the shared RecordLink as its name; richer content (a count with its words) keeps the
 *  shared destination and the same rule. */
export function RecordLink({ table, id, children, className = '' }: { table: string; id: string | null | undefined; children: ReactNode; className?: string }) {
  const canOpen = useCanOpen(table, id)
  if (!id) return <span className={className}>{children}</span>
  if (typeof children === 'string' || typeof children === 'number')
    return <SharedRecordLink table={table} rowId={id} name={String(children)} canOpen={canOpen} className={className} />
  if (!canOpen) return <span className={className} data-record-link="text" data-table={table} data-row={id}>{children}</span>
  return <LinkTo table={table} id={id} className={className}>{children}</LinkTo>
}

function LinkTo({ table, id, children, className }: { table: string; id: string; children: ReactNode; className: string }) {
  const href = useRecordHref(table, id)
  return <a href={href} data-record-link="link" data-table={table} data-row={id} className={`font-medium text-action hover:underline focus-visible:underline ${className}`}>{children}</a>
}
