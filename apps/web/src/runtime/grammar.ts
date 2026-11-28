import { PAGE_ACTIONS, type PageActionName, type PageFunctionName, type PageStateValue } from 'shared'
import { fmtCount, fmtCurrency, fmtDate, fmtDay, fmtNumber } from '@featherbase/shop-floor'

// #1410: the grammar a runtime page is written in (A2UI v1.0's): a path reads a
// value, a dynamic value is a literal, a {"@path"} or a {"@call"}. Pure
// functions over the page's model; nothing here draws or fetches.

export type Row = Record<string, unknown>
/** What a page's paths read: its state, and the rows of each data source. */
export interface PageModel { state: Record<string, PageStateValue>; data: Record<string, Row[]> }
/** Where a value is read: the page, and inside a table's row that row and its place in the model ("/data/lines/0"). */
export interface Scope { model: PageModel; row?: Row; at?: string }

/** A path's value: from the top of the model when it starts with "/", else from the row being drawn. */
export function readPath(path: string, scope: Scope): unknown {
  const fromTop = path.startsWith('/')
  let at: unknown = fromTop ? scope.model : scope.row
  for (const step of fromTop ? path.split('/').slice(1) : path.split('/')) {
    if (typeof at !== 'object' || at === null) return undefined
    at = (at as Record<string, unknown>)[step]
  }
  return at
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
type PageFunction = (args: Json, scope: Scope) => unknown

/** A number, or a number written as text (a Decimal column arrives as text); otherwise nothing. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

/** What a box gives the page for the text typed into it: a number box a number, or nothing when it is empty. */
export function asTyped(text: string, kind: unknown): string | number | null {
  if (kind !== 'number') return text
  return text === '' ? null : Number(text)
}

/** A number with its thousands separated: to `decimals` places when given, else to at most two. */
export function formatNumber(value: unknown, decimals?: unknown): string {
  const number = asNumber(value)
  if (number === null) return '—'
  const places = asNumber(decimals)
  return places === null ? fmtCount(number, 2) : fmtNumber(number, places)
}

/** An amount of money: rupees to two places unless told otherwise. */
export function formatCurrency(value: unknown, currency?: unknown, decimals?: unknown): string {
  const number = asNumber(value)
  return number === null ? '—' : fmtCurrency(number, asNumber(decimals) ?? 2, typeof currency === 'string' && currency ? currency : 'INR')
}

/** A day (YYYY-MM-DD), or the day of an instant, as DD-Mon-YYYY. */
export function formatDate(value: unknown): string {
  if (typeof value !== 'string') return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return fmtDate(value)
  return /^\d{4}-\d{2}-\d{2}[T ]/.test(value) && !Number.isNaN(Date.parse(value)) ? fmtDay(new Date(value)) : '—'
}

const asText = (value: unknown) => (value === null || value === undefined ? '' : String(value))

/** The named functions, each with the arguments the catalog gives it. A function the catalog gains must be added here. */
const FUNCTIONS: Record<PageFunctionName, PageFunction> = {
  eq: ({ a, b }, scope) => resolveValue(a, scope) === resolveValue(b, scope),
  not: ({ value }, scope) => !resolveValue(value, scope),
  and: ({ values }, scope) => (values as unknown[]).every((each) => Boolean(resolveValue(each, scope))),
  or: ({ values }, scope) => (values as unknown[]).some((each) => Boolean(resolveValue(each, scope))),
  // Only the chosen one is worked out.
  choose: ({ key, from, otherwise }, scope) => {
    const name = asText(resolveValue(key, scope))
    return resolveValue(Object.hasOwn(from as Json, name) ? (from as Json)[name] : otherwise ?? null, scope)
  },
  formatNumber: ({ value, decimals }, scope) => formatNumber(resolveValue(value, scope), resolveValue(decimals, scope)),
  formatCurrency: ({ value, currency, decimals }, scope) => formatCurrency(resolveValue(value, scope), resolveValue(currency, scope), resolveValue(decimals, scope)),
  formatDate: ({ value }, scope) => formatDate(resolveValue(value, scope)),
  // Text written out has each ${path} put in; text read from a path is shown as it is.
  formatString: ({ value }, scope) => typeof value === 'string'
    ? value.replace(/\$\{([^}]*)\}/g, (_, path: string) => asText(readPath(path, scope)))
    : asText(resolveValue(value, scope)),
}

/** A dynamic value: a literal is itself, a {"@path"} is read, a {"@call"} is worked out. */
export function resolveValue(value: unknown, scope: Scope): unknown {
  if (isObject(value) && typeof value['@path'] === 'string') return readPath(value['@path'], scope)
  if (isObject(value) && typeof value['@call'] === 'string') return FUNCTIONS[value['@call'] as PageFunctionName](value.args as Json, scope)
  return value
}

/** Where a path is written: a row path at the row's own place in the model. */
export function absolutePath(path: string, scope: Scope): string {
  return path.startsWith('/') ? path : `${scope.at}/${path}`
}

/** `tree` with `value` at `path` ("/data/lines/0/planned_qty"). The old tree is untouched, and so is every branch the path does not pass through. */
export function writePath<Tree>(tree: Tree, path: string, value: unknown): Tree {
  const write = (at: unknown, steps: string[]): unknown => {
    const [step, ...rest] = steps
    if (step === undefined) return value
    if (Array.isArray(at)) return at.map((each: unknown, i) => (String(i) === step ? write(each, rest) : each))
    const held = isObject(at) ? at : {}
    return { ...held, [step]: write(held[step], rest) }
  }
  return write(tree, path.split('/').slice(1)) as Tree
}

/** What an action is fired with: its context as the catalog describes it, each dynamic value resolved where the control sits. */
export function resolveContext(event: { name: PageActionName; context: Json }, scope: Scope): Json {
  const given = event.context
  const kinds: Record<string, { kind: 'text' | 'value' | 'map' }> = PAGE_ACTIONS[event.name].context
  return Object.fromEntries(Object.keys(kinds).filter((key) => given[key] !== undefined).map((key) => {
    const value = given[key]
    if (kinds[key]!.kind === 'map') return [key, Object.fromEntries(Object.entries(value as Json).map(([name, each]) => [name, resolveValue(each, scope)]))]
    return [key, kinds[key]!.kind === 'value' ? resolveValue(value, scope) : value]
  }))
}
