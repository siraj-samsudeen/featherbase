// The org chart Tables' save rules (the platform runs an app's `validators`
// before every save). A validator sees one row, so it keeps what one row can
// decide: the shape of the row and the key columns that make a name unique
// within its store (the platform's `unique` is one column wide). Rules across
// rows are the conflict list's (conflicts.ts).
import { MATERIAL_GROUP, PLANT_CODE, day, exact, fold, text } from './values.ts'

type Row = Record<string, unknown>
export interface ValidatorContext {
  row: Row
  old?: Row
  user: string
  isNew: boolean
  reject(message: string, fields?: Record<string, string>): never
}
type Validator = (context: ValidatorContext) => void

/** Each job's level of the layout: the one place column it names. */
export const JOB_PLACE: Record<string, 'floor' | 'department' | 'section' | null> = {
  'Store Manager': null,
  'Floor Manager': 'floor',
  'Department Manager': 'department',
  'Team Leader': 'section',
  'Staff': 'section',
  'Cluster Manager': null,
}
const PLACES = ['floor', 'department', 'section'] as const

// Codes are checked exactly as they will be stored, never on a trimmed copy:
// the provider filters on them exactly, so a padded code would save and then
// cover nothing. Refused, not rewritten.
function store({ row, reject }: ValidatorContext): string {
  const code = exact(row.store)
  if (!PLANT_CODE.test(code)) reject('A store is its plant code: exactly four digits, with no spaces', { store: 'exactly four digits' })
  return code
}

function subcategory({ row, reject }: ValidatorContext): string {
  const code = exact(row.subcategory)
  if (!MATERIAL_GROUP.test(code)) reject('A subcategory code is exactly nine digits, with no spaces', { subcategory: 'exactly nine digits' })
  return code
}

function period({ row, reject }: ValidatorContext): void {
  const start = day(row.starts_on)
  const end = day(row.ends_on)
  if (end && end <= start) reject('ends_on must come after starts_on: it is the first day the row no longer holds', { ends_on: 'after starts_on' })
}

function alias(context: ValidatorContext, ...scope: string[]): void {
  context.row.alias_key = [...scope, text(context.row.source), fold(context.row.alias)].join('/')
}

export const validators: Record<string, Validator> = {
  'feather_dash.store_rollout'(context) {
    store(context)
  },

  'feather_dash.store_floor'(context) {
    context.row.floor_key = `${store(context)}/${fold(context.row.floor_name)}`
  },

  'feather_dash.department'(context) {
    const { row, old, reject } = context
    const code = store(context)
    const key = text(row.department_key)
    if (old && text(old.department_key) !== key)
      reject('A department_key never changes: it is what loads match on', { department_key: 'never changes' })
    const name = text(row.name)
    row.department_store_key = `${code}/${key}`
    row.name_store_key = name ? `${code}/${fold(name)}` : null
    row.display_name = name || key
  },

  'feather_dash.section'(context) {
    const { row, reject } = context
    const code = store(context)
    if (!(Number(row.team_leaders_allowed) >= 1))
      reject('A section allows at least 1 Team Leader', { team_leaders_allowed: 'at least 1' })
    row.section_key = `${code}/${fold(row.section_name)}`
  },

  'feather_dash.section_subcategory'(context) {
    const code = store(context)
    const group = subcategory(context)
    period(context)
    context.row.placement_key = `${code}/${group}/${day(context.row.starts_on)}`
  },

  'feather_dash.display_location'(context) {
    store(context)
    subcategory(context)
    period(context)
  },

  'feather_dash.job_assignment'(context) {
    const { row, reject } = context
    store(context)
    period(context)
    const job = text(row.job)
    const own = JOB_PLACE[job]
    if (own) {
      if (!text(row[own])) reject(`A ${job} needs a ${own}`, { [own]: 'required for this job' })
    }
    for (const place of PLACES) {
      if (place !== own && text(row[place])) reject(`A ${job} names no ${place}`, { [place]: 'not for this job' })
    }
  },

  'feather_dash.section_alias'(context) {
    alias(context, store(context))
  },

  'feather_dash.floor_alias'(context) {
    alias(context, store(context))
  },

  'feather_dash.job_alias'(context) {
    alias(context)
  },
}
