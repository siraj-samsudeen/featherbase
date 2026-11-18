// #1273 (relational navigation slice 2, C5–C9, C12): a relationship the viewer
// may change reads as a tick list. A group of link-table rows pointing at a
// record ticks one far-side Table (Business Roles "2 of 7"): every choice of it
// listed, ticked ones first. Ticking adds a link row, unticking deletes one.
// Only where the far side is small, and only for someone who may both add and
// delete the link Table's rows.
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Connection } from './connections'
import { dataColumns, readableLinks } from './list-view-columns'
import { linksOnly } from './far-side'
import { NO_COLUMN_TYPES, linkRowsTable, type ColumnDef, type TableMeta } from './meta'
import type { Capabilities } from './session'

type Row = Record<string, unknown>

/** The most choices a tick list lists, and the most rows either side of a grid has. */
export const SMALL_SIDE = 40

/** How many lines a long section shows before it folds (C13). */
export const FOLD_AFTER = 10

/**
 * The column a group's rows tick: the link Table's first readable link that
 * is not the link back, nor into the record's own Table, nor into a Table the
 * record itself links to (a role given at a site, seen from someone at that
 * site, ticks the role). None for a group through a sub-table, or a Table
 * whose rows have names of their own.
 */
export function tickColumn(meta: TableMeta, connection: Pick<Connection, 'column' | 'via'>, record: { table: string; own: Iterable<string> }): ColumnDef | undefined {
  if (connection.via || !linksOnly(meta)) return undefined
  const skip = new Set([record.table, ...record.own])
  const back = meta.columns.find((c) => c.column_name === connection.column)
  // Ticking writes both links: a read-only one would be dropped on save (Codex review).
  if (!back || back.column_type !== 'Reference' || back.read_only) return undefined
  const far = readableLinks(meta).find((c) => c.column_name !== connection.column && !skip.has(linkRowsTable(c) ?? ''))
  return far && !far.read_only ? far : undefined
}

const BOOKKEEPING = /^(created|updated|modified|deleted)_(on|at|by|by_id|date)$/i
const NOT_IN_FORM = new Set(['Attach', 'Attach Image', 'JSON', 'Table MultiSelect'])
const ORDER: Record<string, number> = { Reference: 0, Date: 1, Datetime: 1 }

/** The fields the inline form asks for (C8): the link Table's own editable
 *  columns beyond the two links, areas (its other links) first, then dates,
 *  then the rest (a reason). */
export function formColumns(meta: TableMeta, links: string[]): ColumnDef[] {
  return dataColumns(meta)
    .filter((c) => !links.includes(c.column_name) && !c.read_only && !NO_COLUMN_TYPES.has(c.column_type)
      && !NOT_IN_FORM.has(c.column_type) && !BOOKKEEPING.test(c.column_name) && !(c.column_type === 'Reference' && !c.reference_table))
    .sort((a, b) => (ORDER[a.column_type] ?? 2) - (ORDER[b.column_type] ?? 2))
}

/** A date that ends something reads "until 31-Mar-2027" (C5). */
export function isUntil(c: Pick<ColumnDef, 'column_name' | 'label'>): boolean {
  return /\b(end|ends|ending|ended|until|till|expires?|expiry|valid to)\b/i.test(`${c.label ?? ''} ${c.column_name.replace(/_/g, ' ')}`)
}

export interface Choice { id: string; title: string }
export interface TickedLine { row: Row; choice: Choice }

/** The lines in order: each link row under its choice, by the choices' order,
 *  then the choices no row ticks. A row whose choice is not listed (one the
 *  viewer may not read) stays among the ticked, last. */
export function tickLines(choices: Choice[], rows: Row[], column: string): { ticked: TickedLine[]; unticked: Choice[] } {
  const at = new Map(choices.map((c, i) => [c.id, i]))
  const ticked = rows
    .map((row) => {
      const id = String(row[column] ?? '')
      return { row, choice: choices[at.get(id) ?? -1] ?? { id, title: '' }, place: at.get(id) ?? choices.length }
    })
    .sort((a, b) => a.place - b.place)
    .map(({ row, choice }) => ({ row, choice }))
  const used = new Set(rows.map((r) => String(r[column] ?? '')))
  return { ticked, unticked: choices.filter((c) => !used.has(c.id)) }
}

/** "2 of 7": how many choices are ticked, of all. */
export function tickCount(lines: { ticked: TickedLine[] }, choices: Choice[]): string {
  const ticked = new Set(lines.ticked.map((l) => l.choice.id))
  return `${choices.filter((c) => ticked.has(c.id)).length} of ${choices.length}`
}

/** May this viewer tick the link Table's rows: add AND delete them, on a Table
 *  of its own that takes writes (not system-written, archived or source-bound). */
export function mayTick(caps: Pick<Capabilities, 'manage' | 'creatable'> & { deletable?: string[] } | undefined, meta: TableMeta): boolean {
  if (!caps) return false
  // A source-bound Table's rows carry no maker or revision here: it lists, never ticks.
  if (meta.system_written || meta.archived_at || meta.data_source || meta.kind !== 'table') return false
  // A row whose id its maker types has no box for it here: such a Table lists (Codex review).
  if (meta.id_pattern === 'prompt') return false
  return caps.manage || (caps.creatable.includes(meta.name) && Boolean(caps.deletable?.includes(meta.name)))
}

/** Grid only for small pairs (A2, C12): both sides counted and about 40 or fewer. */
export function gridOffered(sideA: number | undefined, sideB: number | undefined): boolean {
  return sideA !== undefined && sideB !== undefined && sideA <= SMALL_SIDE && sideB <= SMALL_SIDE
}

/** Where Correct leads for one row: the Table's correction path with each
 *  {column} filled from the row. None when the Table names none. */
export function correctionHref(path: string | null | undefined, row: Row): string | undefined {
  if (!path) return undefined
  return path.replace(/\{([^}]*)\}/g, (_, name: string) => encodeURIComponent(String(row[name] ?? '')))
}

/** The values a ticked choice is saved with: the link back, the choice, and the
 *  fields filled in (blank ones left out). */
export function newLinkRow(backLink: string, record: string, column: string, choice: string, fields: Row): Row {
  const filled = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  return { ...filled, [backLink]: record, [column]: choice }
}

/** Where each row came from (C6): a feed by its name, or null for by hand. Rows
 *  the viewer may not read are absent. A Table bound to a source answers alike. */
export function useRowSources(table: string, ids: string[], enabled = true) {
  return useQuery({
    queryKey: ['row-sources', table, ids],
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    queryFn: () => api.get<{ sources: Record<string, string | null> }>(
      `/api/table/${encodeURIComponent(table)}:row_sources?ids=${encodeURIComponent(JSON.stringify(ids))}`),
  })
}
