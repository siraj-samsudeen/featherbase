import type { ListFilter } from 'shared'

// #910 D1/D2: the navigation path. Every drill and every filter is a step;
// each step is the whole screen state at that moment, as identities only
// (table names, row ids, column names), never row names — names are looked
// up per viewer through the permission-scoped title lookup (row-titles.tsx),
// so a shared link never shows a colleague a name they may not read.
// The path lives in one address parameter, which is user input: decoding
// discards what is malformed (the parseFilters / parseChain way) and never
// throws. Moving back and drilling elsewhere drops the later steps, like a
// browser's history.

export const MAX_STEPS = 12
export const MAX_RECENT = 10
// Longest table name, row id, column name or filter value a step may carry.
const MAX_STRING = 200
const MAX_FILTERS = 50
const MAX_LIST = 200
// Longest encoded path accepted, so a pasted megabyte is never parsed.
const MAX_ENCODED = 64_000

type Scalar = string | number | boolean | null
export type NavFilterValue = Scalar | Scalar[]

export interface NavGroup {
  table: string
  column: string
  via?: string | null
}

export interface NavPane {
  table: string
  row: string
  group?: NavGroup
  tab?: 'fields'
}

export interface NavStep {
  screen: 'list' | 'row'
  table: string
  // the row page's centre; present exactly when screen is 'row'
  row?: string
  filters?: ListFilter[]
  pane?: NavPane
  view?: 'form' | 'map' | 'tree'
  // tree node ids unfolded
  expanded?: string[]
  place?: 'auto' | 'right' | 'bottom'
  compact?: boolean
}

export interface NavPath {
  steps: NavStep[]
  // index of the current step; -1 only for the empty path
  at: number
}

export type StepKind = 'list' | 'filter' | 'row' | 'pane' | 'group'

export const EMPTY_PATH: NavPath = { steps: [], at: -1 }

// ---------- validation ----------

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_STRING
const onlyKeys = (o: Obj, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k))
const oneOf = <T extends string>(v: unknown, options: readonly T[]): v is T =>
  typeof v === 'string' && (options as readonly string[]).includes(v)

function isScalar(v: unknown): v is Scalar {
  if (v === null || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  return typeof v === 'string' && v.length <= MAX_STRING
}

function readFilters(v: unknown): ListFilter[] | null {
  if (!Array.isArray(v) || v.length > MAX_FILTERS) return null
  const out: ListFilter[] = []
  for (const f of v) {
    if (!Array.isArray(f) || f.length !== 3 || !isId(f[0]) || !isId(f[1])) return null
    const value: unknown = f[2]
    const ok = Array.isArray(value) ? value.length <= MAX_LIST && value.every(isScalar) : isScalar(value)
    if (!ok) return null
    out.push([f[0], f[1], Array.isArray(value) ? [...value] : value])
  }
  return out
}

function readGroup(v: unknown): NavGroup | null {
  if (!isObj(v) || !onlyKeys(v, ['table', 'column', 'via'])) return null
  if (!isId(v.table) || !isId(v.column)) return null
  if (v.via !== undefined && v.via !== null && !isId(v.via)) return null
  const group: NavGroup = { table: v.table, column: v.column }
  if (v.via !== undefined) group.via = v.via as string | null
  return group
}

function readPane(v: unknown): NavPane | null {
  if (!isObj(v) || !onlyKeys(v, ['table', 'row', 'group', 'tab'])) return null
  if (!isId(v.table) || !isId(v.row)) return null
  const pane: NavPane = { table: v.table, row: v.row }
  if (v.group !== undefined) {
    const group = readGroup(v.group)
    if (!group) return null
    pane.group = group
  }
  if (v.tab !== undefined) {
    if (v.tab !== 'fields') return null
    pane.tab = v.tab
  }
  return pane
}

const STEP_KEYS = ['screen', 'table', 'row', 'filters', 'pane', 'view', 'expanded', 'place', 'compact'] as const

// A valid step, rebuilt in a fixed key order (so equal steps encode the
// same), or null.
function readStep(v: unknown): NavStep | null {
  if (!isObj(v) || !onlyKeys(v, STEP_KEYS)) return null
  if (!oneOf(v.screen, ['list', 'row'] as const) || !isId(v.table)) return null
  const step: NavStep = { screen: v.screen, table: v.table }
  if (v.screen === 'row') {
    if (!isId(v.row)) return null
    step.row = v.row
  } else if (v.row !== undefined) return null
  if (v.filters !== undefined) {
    const filters = readFilters(v.filters)
    if (!filters) return null
    step.filters = filters
  }
  if (v.pane !== undefined) {
    const pane = readPane(v.pane)
    if (!pane) return null
    step.pane = pane
  }
  if (v.view !== undefined) {
    if (!oneOf(v.view, ['form', 'map', 'tree'] as const)) return null
    step.view = v.view
  }
  if (v.expanded !== undefined) {
    if (!Array.isArray(v.expanded) || v.expanded.length > MAX_LIST || !v.expanded.every(isId)) return null
    step.expanded = [...(v.expanded as string[])]
  }
  if (v.place !== undefined) {
    if (!oneOf(v.place, ['auto', 'right', 'bottom'] as const)) return null
    step.place = v.place
  }
  if (v.compact !== undefined) {
    if (typeof v.compact !== 'boolean') return null
    step.compact = v.compact
  }
  return step
}

// A step from the app's own code is typed already; rebuilding it drops
// undefined fields so equality and encoding are stable.
const normalise = (step: NavStep): NavStep => readStep(JSON.parse(JSON.stringify(step))) ?? step
const sameStep = (a: NavStep, b: NavStep) => JSON.stringify(normalise(a)) === JSON.stringify(normalise(b))

// ---------- moving along the path ----------

export function push(path: NavPath, step: NavStep): NavPath {
  const current = path.steps[path.at]
  if (current && sameStep(current, step)) return path
  const steps = [...path.steps.slice(0, path.at + 1), normalise(step)].slice(-MAX_STEPS)
  return { steps, at: steps.length - 1 }
}

export function go(path: NavPath, i: number): NavPath {
  if (path.steps.length === 0) return path
  const at = Math.min(Math.max(Math.trunc(i), 0), path.steps.length - 1)
  return { steps: path.steps, at }
}

export const back = (path: NavPath) => go(path, path.at - 1)
export const forward = (path: NavPath) => go(path, path.at + 1)

// ---------- the address parameter ----------

export function encodePath(path: NavPath): string {
  return JSON.stringify({ steps: path.steps.map(normalise), at: path.at })
}

// `raw` is the search param as a string, or the value a router already
// JSON-parsed from it. Invalid steps are dropped; null when nothing usable
// is left.
export function decodePath(raw: unknown): NavPath | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    if (!raw || raw.length > MAX_ENCODED) return null
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!isObj(value) || !Array.isArray(value.steps)) return null
  const rawAt = Number.isInteger(value.at) ? (value.at as number) : value.steps.length - 1
  const steps: NavStep[] = []
  // the current step's position among the kept steps; a dropped current
  // step falls back to the kept step before it
  let at = -1
  value.steps.forEach((entry: unknown, i: number) => {
    const step = readStep(entry)
    if (step) steps.push(step)
    if (i <= rawAt) at = steps.length - 1
  })
  if (steps.length === 0) return null
  const dropped = Math.max(steps.length - MAX_STEPS, 0)
  const kept = steps.slice(dropped)
  return { steps: kept, at: Math.min(Math.max(at - dropped, 0), kept.length - 1) }
}

// ---------- what the path bar shows ----------

export function stepKind(step: NavStep): StepKind {
  if (step.pane?.group) return 'group'
  if (step.pane) return 'pane'
  if (step.screen === 'row') return 'row'
  return step.filters?.length ? 'filter' : 'list'
}

// The rows whose titles the path bar must look up, in the shape
// row-titles.tsx batches.
export function stepRefs(step: NavStep): { table: string; row_id: string }[] {
  const refs: { table: string; row_id: string }[] = []
  if (step.screen === 'row' && step.row) refs.push({ table: step.table, row_id: step.row })
  const pane = step.pane
  if (pane && !refs.some((r) => r.table === pane.table && r.row_id === pane.row))
    refs.push({ table: pane.table, row_id: pane.row })
  return refs
}

// ---------- recent paths (D2: per-person settings) ----------

export function rememberPath(list: NavPath[], path: NavPath): NavPath[] {
  const key = encodePath(path)
  return [path, ...list.filter((p) => encodePath(p) !== key)].slice(0, MAX_RECENT)
}

// Stored recent paths, each as an encoded string or a parsed object; the
// malformed are dropped, repeats kept once, at most MAX_RECENT.
export function decodeRecent(raw: unknown): NavPath[] {
  if (!Array.isArray(raw)) return []
  const out: NavPath[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (out.length === MAX_RECENT) break
    const path = decodePath(entry)
    if (!path) continue
    const key = encodePath(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
  }
  return out
}
