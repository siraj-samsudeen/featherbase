import type { SessionUser } from './auth'

// API surface design (#61): one registry, one dispatcher, four cases.
//
//   Generated         GET/POST /api/table/:table, GET/PATCH/DELETE
//                     /api/table/:table/:name, plus :count/:meta/:actions —
//                     derivable for every Table from metadata alone, so
//                     nothing is registered here; index.ts handles it inline.
//   Row action        registerRowAction() — scoped to one (table, name),
//                     reached at /api/table/:table/:name:action.
//   Collection action registerCollectionAction() — scoped to a Table as a
//                     whole (not a specific row), reached at
//                     /api/table/:table:action.
//   Method            methods.ts's existing whitelist() — not addressed by
//                     any Table at all, reached at /api/method/:path.
//
// Every case shares the same rule: the HTTP verb is derived from a declared
// `effect: 'read' | 'write'`, never chosen ad hoc by the handler (#62).
// Colon-suffix, not a slash sub-path — row/Table names can already contain
// arbitrary characters (autoname: 'prompt'), so /table/:name/submit is
// genuinely ambiguous with a row literally named ".../submit"; the colon is
// the disambiguator, not a style preference.

export type ActionEffect = 'read' | 'write'

export interface RowActionContext {
  table: string
  name: string
  args: Record<string, unknown>
  user: SessionUser
}

export interface CollectionActionContext {
  table: string
  args: Record<string, unknown>
  user: SessionUser
}

export interface ActionDef<Ctx> {
  effect: ActionEffect
  handler: (ctx: Ctx) => unknown | Promise<unknown>
  // Surfaced by the discovery endpoint (GET /api/table/:table:actions) so a
  // generic FormView can render an action button with zero frontend code
  // (architecture invariant #3) — no input schema yet, just the contract.
  description: string
}

const rowActions = new Map<string, ActionDef<RowActionContext>>()
const collectionActions = new Map<string, ActionDef<CollectionActionContext>>()

// Names the generated layer already owns — a registered action can never
// shadow generated behavior (:meta/:count/:actions are handled inline by the
// dispatcher for every Table, not through this registry).
const RESERVED = new Set(['meta', 'count', 'distinct', 'actions'])

export function registerRowAction(name: string, def: ActionDef<RowActionContext>): void {
  if (RESERVED.has(name)) throw new Error(`":${name}" is reserved for the generated Table layer`)
  rowActions.set(name, def)
}

export function registerCollectionAction(
  name: string,
  def: ActionDef<CollectionActionContext>,
): void {
  if (RESERVED.has(name)) throw new Error(`":${name}" is reserved for the generated Table layer`)
  collectionActions.set(name, def)
}

export function getRowAction(name: string): ActionDef<RowActionContext> | undefined {
  return rowActions.get(name)
}

export function getCollectionAction(
  name: string,
): ActionDef<CollectionActionContext> | undefined {
  return collectionActions.get(name)
}

// GET /api/table/:table:actions — every registered action is listed for
// every Table (today's registry has no per-Table scoping: an action either
// exists for all Tables or none, matching how submit/cancel/amend already
// work — the engine itself decides applicability, e.g. "not submittable").
export function listActions(): {
  row: { action: string; effect: ActionEffect; description: string }[]
  collection: { action: string; effect: ActionEffect; description: string }[]
} {
  return {
    row: [...rowActions.entries()].map(([action, d]) => ({
      action,
      effect: d.effect,
      description: d.description,
    })),
    collection: [...collectionActions.entries()].map(([action, d]) => ({
      action,
      effect: d.effect,
      description: d.description,
    })),
  }
}

// Colon-suffix parsing: split "name:action" on the LAST colon, but only
// treat it as an action if the suffix names something the dispatcher
// actually recognizes (a reserved generated name or a registered action) —
// otherwise the whole segment is the literal row/Table name, so a name that
// happens to contain a colon still round-trips for plain CRUD.
export function splitSuffix(
  segment: string,
  isKnown: (suffix: string) => boolean,
): { base: string; suffix: string | null } {
  const i = segment.lastIndexOf(':')
  if (i === -1) return { base: segment, suffix: null }
  const base = segment.slice(0, i)
  const suffix = segment.slice(i + 1)
  return isKnown(suffix) ? { base, suffix } : { base: segment, suffix: null }
}

export function isKnownRowSuffix(suffix: string): boolean {
  return RESERVED.has(suffix) || rowActions.has(suffix)
}

export function isKnownCollectionSuffix(suffix: string): boolean {
  return RESERVED.has(suffix) || collectionActions.has(suffix)
}
