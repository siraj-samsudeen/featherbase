// The org chart Tables' save rules (the platform runs an app's `validators`
// before every save). Most keep what one row can decide: the shape of the row
// and the key columns that make a name unique within its store (the platform's
// `unique` is one column wide); the org chart's rules across rows, a person's
// time shares included, are the conflict list's (conflicts.ts). Employment's
// rules across rows are refused at save instead: they read the person's other
// stints in the save's transaction, after locking the person's employee row.
import { MATERIAL_GROUP, PLANT_CODE, day, exact, fold, text } from './values.ts'
import { employmentProblem } from './people.ts'

type Row = Record<string, unknown>
type Filter = [string, string, unknown]
/** The platform's documents, read as the caller in the save's transaction; `get` locks the row it reads. */
export interface ValidatorDocuments {
  get(table: string, id: string): Promise<Row>
  list(table: string, args?: { filters?: Filter[]; fields?: string[]; order_by?: string; limit_start?: number; limit_page_length?: number }): Promise<Row[]>
}
export interface ValidatorContext {
  row: Row
  old?: Row
  user: string
  isNew: boolean
  documents?: ValidatorDocuments
  reject(message: string, fields?: Record<string, string>): never
}
// The shape rules throw before any read, so a validator refuses a malformed row synchronously.
type Validator = (context: ValidatorContext) => void | Promise<void>

/** Each job's level of the layout: the one place column it names. */
export const JOB_PLACE: Record<string, 'floor' | 'department' | 'section' | null> = {
  'Director': null,
  'Chief Operating Officer': null,
  'Cluster Manager': null,
  'Store Manager': null,
  'Floor Manager': 'floor',
  'Department Manager': 'department',
  'Team Leader': 'section',
  'Staff': 'section',
}
const PLACES = ['floor', 'department', 'section'] as const
const ASSIGNMENT_TYPES = ['Primary', 'Secondary', 'Temporary deployment']
const PAGE = 500

/** Every row a filter names, a page at a time in row_id order. */
async function all(documents: ValidatorDocuments, table: string, filters: Filter[], fields: string[]): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { filters, fields, order_by: 'row_id asc', limit_start: rows.length, limit_page_length: PAGE })
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

const EMPLOYEE = 'dash.employee'
const EMPLOYMENT_FIELDS = ['row_id', 'employee', 'legal_company', 'employee_number', 'joined_on', 'left_on']

/** A whole number, or blank; refused otherwise. */
function count(context: ValidatorContext, column: string): number | null {
  const value = context.row[column]
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) context.reject('An approved headcount is a whole number, 0 or more', { [column]: 'a whole number' })
  return n
}

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
  'dash.store_rollout'(context) {
    store(context)
  },

  'dash.store_floor'(context) {
    context.row.floor_key = `${store(context)}/${fold(context.row.floor_name)}`
  },

  'dash.department'(context) {
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

  'dash.section'(context) {
    const { row, reject } = context
    const code = store(context)
    if (!(Number(row.team_leaders_allowed) >= 1))
      reject('A section allows at least 1 Team Leader', { team_leaders_allowed: 'at least 1' })
    const [min, max] = [count(context, 'approved_headcount_min'), count(context, 'approved_headcount_max')]
    if (min != null && max != null && min > max)
      reject('The approved headcount\'s maximum is at least its minimum', { approved_headcount_max: 'at least the minimum' })
    row.section_key = `${code}/${fold(row.section_name)}`
  },

  'dash.section_subcategory'(context) {
    const code = store(context)
    const group = subcategory(context)
    period(context)
    context.row.placement_key = `${code}/${group}/${day(context.row.starts_on)}`
  },

  'dash.display_location'(context) {
    store(context)
    subcategory(context)
    period(context)
  },

  'dash.job_assignment'(context) {
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
    const isCluster = job === 'Cluster Manager'
    if (isCluster && !exact(row.cluster)) reject('A Cluster Manager needs the cluster they manage', { cluster: 'required for this job' })
    if (isCluster && exact(row.cluster) !== text(row.cluster)) reject('A cluster is its code, with no spaces around it', { cluster: 'no spaces' })
    if (!isCluster && text(row.cluster)) reject(`A ${job} names no cluster`, { cluster: 'Cluster Manager only' })
    if (!ASSIGNMENT_TYPES.includes(text(row.assignment_type)))
      reject('An assignment is Primary, Secondary or a Temporary deployment', { assignment_type: 'Primary, Secondary or Temporary deployment' })
    const percentage = Number(row.percentage)
    if (row.percentage == null || row.percentage === '' || !(percentage > 0 && percentage <= 100))
      reject('A percentage is more than 0 and at most 100', { percentage: 'more than 0, at most 100' })
  },

  'dash.employment'(context) {
    const { row, reject, documents } = context
    const start = day(row.joined_on)
    const end = day(row.left_on)
    if (end && end <= start) reject('left_on must come after joined_on: it is the first day the person no longer works here', { left_on: 'after joined_on' })
    for (const column of ['legal_company', 'employee_number'])
      if (exact(row[column]) !== text(row[column])) reject('Codes are kept exactly, with no spaces around them', { [column]: 'no spaces' })
    if (!documents) return
    return (async () => {
      const employee = exact(row.employee)
      // Locks the employee row: two stints of one person are saved one after the other.
      await documents.get(EMPLOYEE, employee)
      const stints = await all(documents, 'dash.employment', [['employee', '=', employee]], EMPLOYMENT_FIELDS)
      const holders = await all(documents, 'dash.employment',
        [['legal_company', '=', exact(row.legal_company)], ['employee_number', '=', exact(row.employee_number)]], EMPLOYMENT_FIELDS)
      const problem = employmentProblem(row, [...stints, ...holders])
      if (problem) reject(problem.message, { [problem.field]: problem.message })
    })()
  },

  'dash.designation'(context) {
    context.row.title_key = fold(context.row.title)
  },

  'dash.designation_alias'(context) {
    alias(context)
  },

  'dash.section_alias'(context) {
    alias(context, store(context))
  },

  'dash.floor_alias'(context) {
    alias(context, store(context))
  },

  'dash.job_alias'(context) {
    alias(context)
  },
}
