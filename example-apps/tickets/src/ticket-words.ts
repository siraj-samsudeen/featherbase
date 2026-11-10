export const kinds: Record<string, string> = {
  generic: 'General request',
  access: 'Access request',
  freshness: 'Stale / missing data',
  quality: 'Wrong data / reconciliation',
  report: 'Report / export',
  source: 'New source',
  schema: 'New column / model',
  pipeline: 'Pipeline failure',
  backfill: 'Backfill',
}
export const fields: Record<string, [string, string, string?][]> = {
  generic: [],
  access: [
    ['email', 'Recipient email', 'email'],
    ['resource', 'Resource / database / table'],
    ['scope', 'Requested scope / permissions'],
  ],
  freshness: [
    ['source', 'Source'],
    ['report', 'Affected report / table'],
    ['store', 'Store / location'],
    ['period', 'Affected period'],
    ['expected', 'Expected data'],
    ['actual', 'Actual data'],
    ['example', 'Example record / invoice IDs'],
  ],
  quality: [
    ['source', 'Source'],
    ['report', 'Affected report / table'],
    ['expected', 'Expected result'],
    ['actual', 'Actual result'],
    ['period', 'Affected period'],
    ['example', 'Example records'],
  ],
  report: [
    ['report', 'Report / data needed'],
    ['store', 'Store / location'],
    ['from', 'From date', 'date'],
    ['through', 'Through date', 'date'],
    ['format', 'Output format'],
    ['recipients', 'Recipients'],
  ],
  source: [
    ['source', 'Source name'],
    ['vendor', 'Vendor / contact'],
    ['api', 'API / access requirements'],
    ['entity', 'Entities / data needed'],
    ['refresh', 'Refresh frequency'],
  ],
  schema: [
    ['model', 'Model / table'],
    ['column', 'Column'],
    ['definition', 'Business definition'],
    ['example', 'Example value / use case'],
  ],
  pipeline: [
    ['pipeline', 'Pipeline / job'],
    ['failure', 'Failure / error'],
    ['expected', 'Expected result'],
    ['actual', 'Actual result'],
    ['period', 'Affected period'],
  ],
  backfill: [
    ['source', 'Source / table'],
    ['from', 'From date', 'date'],
    ['through', 'Through date', 'date'],
    ['scope', 'Scope / affected reports'],
    ['expected', 'Expected result'],
  ],
}
export const connectionNames: Record<string, string> = {
  employee: 'Employee lookup',
  email: 'Inbound email',
  investigation: 'Automated investigation',
}
export const stateLabel = (state: string) =>
  state.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
export const short = (id: string) =>
  id === 'Administrator'
    ? id
    : id.length > 24
      ? `${id.slice(0, 8)}…${id.slice(-4)}`
      : id
// Ticket types the instance configured (Tickets configuration Tables), with
// their fields and the options their links and people offer this viewer.
export type ConfiguredField = { name: string; label: string; type: string; required: boolean; choices?: string[]; options?: { value: string; label: string }[]; asked_by_action?: boolean }
type ConfiguredType = { key: string; label: string; states: string[]; done: string[]; fields: ConfiguredField[]; transitions?: boolean; details_visible_to?: 'everyone' | 'private'; enabled?: boolean }
// #918: an action the viewer may take now, and what it asks them to record.
export type TicketAction = { action: string; next_state: string; fields: ConfiguredField[] }
export const configuredTypes: Record<string, ConfiguredType> = {}
export const learnTypes = (types: unknown) => {
  for (const type of Array.isArray(types) ? (types as (ConfiguredType & { builtin?: boolean })[]) : [])
    if (!type.builtin) configuredTypes[type.key] = type
}
export const kindLabel = (key: string) => kinds[key] ?? configuredTypes[key]?.label ?? stateLabel(key)
// #912: people are shown by name. The reads return the names of the people
// they mention; an id with no known name is never shown as-is.
const knownNames: Record<string, string> = {}
export const learnNames = (names: unknown) => {
  if (names && typeof names === 'object') Object.assign(knownNames, names)
}
const isPersonId = (value: string) => value === 'Administrator' || /^(psn|sa)_[a-z0-9]{8,}$/.test(value)
export const person = (id: unknown): string =>
  typeof id !== 'string' || !id
    ? '—'
    : (knownNames[id] ?? (isPersonId(id) ? 'Unnamed person' : id))
// Dates read DD-Mon-YYYY (04-Nov-2026), never a slash form.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = (n: number) => String(n).padStart(2, '0')
const dayMonthYear = (d: Date) => `${two(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`
const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/
export const display = (value: unknown): string =>
  value == null
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value, (_key, item) => typeof item === 'string' && knownNames[item] ? knownNames[item] : item, 2)
      : typeof value === 'string'
        ? isoDate.test(value)
          ? value.replace(isoDate, (_m, y, mo, d) => `${d}-${MONTHS[Number(mo) - 1]}-${y}`)
          : person(value)
        : String(value)
export const time = (value: unknown) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || isoDate.test(value)) return display(value)
  const d = new Date(value)
  return `${dayMonthYear(d)}, ${two(d.getHours())}:${two(d.getMinutes())}`
}
