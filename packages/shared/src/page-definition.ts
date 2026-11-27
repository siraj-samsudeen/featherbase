// #1410 (ADR 0028): a runtime page. A page is a screen saved as data: an
// envelope of Featherbase's own (version, state, data) around a body written in
// A2UI v1.0's grammar (a flat list of parts with ids, {"@path"} to read a value,
// {"@call"} for a named function, action.event for what a control does).
//
// This file is the one place that says what a page may hold: the parts and their
// settings, the named functions and the named actions. The checker reads those
// lists, so does the catalog an agent reads, and the web runtime's types come
// from them, so the three cannot disagree. The checker reports EVERY mistake,
// keyed by where it is, in the words an agent can act on.
//
// Not drawn, and so refused as unknown settings rather than silently accepted:
// A2UI's @checks, @accessibility, @metadata, @catalogId and functionCall actions.

/** The A2UI specification version a page's body is written in. */
export const PAGE_SPEC_VERSION = '1.0'
/** The most rows one data source of a page asks for: the list API's own page cap. */
export const PAGE_ROW_CAP = 500
export const PAGE_STATUSES = ['Draft', 'Published'] as const
export type PageStatus = (typeof PAGE_STATUSES)[number]
/** A page's name is its address: lower-case words joined by hyphens. */
export const PAGE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const pageHref = (name: string) => `/featherbase/admin/page/${encodeURIComponent(name)}`
/** The columns every row carries, whatever the Table: a page may read them without listing them. */
export const PAGE_ROW_COLUMNS = ['row_id', 'updated_at'] as const

export type PathRef = { '@path': string }
export type CallRef = { '@call': string; args?: Record<string, unknown> }
export type ChildList = string[] | { componentId: string; path: string }
export interface PagePart { id: string; component: string; [setting: string]: unknown }
export interface PageTableSource { table: string; filters?: [string, string, unknown][]; columns?: string[]; order_by?: string; limit?: number }
export interface PageSampleSource { sample: Record<string, unknown>[] }
export type PageSource = PageTableSource | PageSampleSource
export type PageStateValue = string | number | boolean
export interface PageDefinition {
  version: typeof PAGE_SPEC_VERSION
  state?: Record<string, PageStateValue>
  data?: Record<string, PageSource>
  components: PagePart[]
}
export interface PageTableColumn {
  id: string
  header: unknown
  value?: unknown
  cell?: string
  align?: 'start' | 'end'
  format?: 'text' | 'number' | 'currency' | 'date'
  total?: 'sum'
  visible?: unknown
}
export interface PageTableBand { label: string; columns: string[] }

// ---------------------------------------------------------------------------
// The catalog: parts, functions, actions.

/** What a setting holds. `string`, `number`, `boolean` and `value` are dynamic:
 *  a literal, a {"@path"} or a {"@call"}. `text` is always written out. */
type Kind = 'text' | 'string' | 'number' | 'boolean' | 'value' | 'bound' | 'children' | 'action' | 'options' | 'columns' | 'bands'
interface Setting { kind: Kind; about: string; required?: true; values?: readonly string[] }
interface PartSpec { about: string; settings: Record<string, Setting> }

const KIND_WORDS: Record<Kind, string> = {
  text: 'text, written out',
  string: 'text, a {"@path"} or a {"@call"}',
  number: 'a number, a {"@path"} or a {"@call"}',
  boolean: 'true or false, a {"@path"} or a {"@call"}',
  value: 'any value, a {"@path"} or a {"@call"}',
  bound: 'a {"@path"}: the value the part reads and writes',
  children: 'a list of part ids, or {"componentId", "path"} to repeat one part over rows',
  action: '{"event": {"name", "context"}}',
  options: 'a list of {"value", "label"}',
  columns: 'a list of columns',
  bands: 'a list of {"label", "columns"}',
}

export const PAGE_PARTS = {
  Page: {
    about: 'The page itself: its heading, and the parts under it. Always the part with id "root", and only there.',
    settings: {
      title: { kind: 'string', required: true, about: 'The heading.' },
      actions: { kind: 'children', about: 'Parts drawn on the heading\'s line, at the right, such as a Toggle.' },
      children: { kind: 'children', required: true, about: 'The parts under the heading, top to bottom.' },
    },
  },
  Stack: {
    about: 'Parts one under another.',
    settings: {
      children: { kind: 'children', required: true, about: 'The parts, top to bottom.' },
      gap: { kind: 'text', values: ['small', 'medium', 'large'], about: 'The space between them. medium when left out.' },
    },
  },
  Row: {
    about: 'Parts side by side.',
    settings: {
      children: { kind: 'children', required: true, about: 'The parts, left to right.' },
      align: { kind: 'text', values: ['start', 'center', 'end', 'between'], about: 'Where they sit across the row. start when left out.' },
    },
  },
  Text: {
    about: 'A line of text.',
    settings: {
      text: { kind: 'string', required: true, about: 'What it says.' },
      variant: { kind: 'text', values: ['body', 'heading', 'caption', 'figure'], about: 'How it reads. body when left out; figure is one large number.' },
    },
  },
  Notice: {
    about: 'A message set apart from the page, such as a warning.',
    settings: {
      text: { kind: 'string', required: true, about: 'What it says.' },
      tone: { kind: 'text', values: ['info', 'positive', 'caution', 'negative'], about: 'info when left out.' },
    },
  },
  RecordLink: {
    about: 'A row of a Table, shown as a link that opens it. Use it wherever a page names a record.',
    settings: {
      table: { kind: 'text', required: true, about: 'The Table the row is in.' },
      row: { kind: 'string', required: true, about: 'The row\'s id, usually {"@path": "row_id"}.' },
      label: { kind: 'string', required: true, about: 'What the link says.' },
    },
  },
  Table: {
    about: 'Rows as a table: columns, bands over groups of columns, and groups of rows that open in place with their totals.',
    settings: {
      caption: { kind: 'text', required: true, about: 'What the table holds, for someone who cannot see it.' },
      rows: { kind: 'bound', required: true, about: 'The rows: {"@path": "/data/<source>"}.' },
      columns: { kind: 'columns', required: true, about: 'Each column: id, header, and value (what a row shows) or cell (the id of a part drawn in each row), or both. Also align (start, end), format (text, number, currency, date), total ("sum": a group\'s row adds the value up) and visible.' },
      bands: { kind: 'bands', about: 'A second header row above the first: each band\'s label spans the columns it names, which must sit next to each other.' },
      group_by: { kind: 'text', about: 'A column of the rows. One row is drawn per value of it, and a group\'s rows show when it is opened.' },
      open: { kind: 'bound', about: 'With group_by: a {"@path": "/state/<key>"} holding which group is open.' },
      row_key: { kind: 'text', about: 'The column that tells rows apart. row_id when left out.' },
    },
  },
  Toggle: {
    about: 'A few choices side by side, one of them chosen.',
    settings: {
      label: { kind: 'text', required: true, about: 'What is being chosen, for someone who cannot see it.' },
      options: { kind: 'options', required: true, about: 'The choices.' },
      value: { kind: 'bound', required: true, about: 'Where the chosen value is kept, usually {"@path": "/state/<key>"}.' },
    },
  },
  Input: {
    about: 'A box to type in. Typing changes the page\'s own copy of the value; nothing is saved until a Button fires an action.',
    settings: {
      label: { kind: 'text', required: true, about: 'What the box is for.' },
      value: { kind: 'bound', required: true, about: 'The value it shows and changes, such as {"@path": "planned_qty"} in a table\'s row.' },
      kind: { kind: 'text', values: ['text', 'number'], about: 'text when left out.' },
      placeholder: { kind: 'string', about: 'Shown while the box is empty.' },
    },
  },
  Button: {
    about: 'A button that fires one action.',
    settings: {
      label: { kind: 'string', required: true, about: 'What it says.' },
      action: { kind: 'action', required: true, about: 'What it does.' },
      variant: { kind: 'text', values: ['primary', 'secondary', 'quiet'], about: 'secondary when left out. At most one primary on a page.' },
    },
  },
} as const satisfies Record<string, PartSpec>
export type PagePartName = keyof typeof PAGE_PARTS

/** What a function's argument holds: one dynamic value, a list of them, a set of named ones, or text with ${path} in it. */
type ArgKind = 'value' | 'values' | 'map' | 'template'
interface Arg { kind: ArgKind; required?: true }
interface FunctionSpec { about: string; args: Record<string, Arg> }

export const PAGE_FUNCTIONS = {
  eq: { about: 'true when a and b are the same.', args: { a: { kind: 'value', required: true }, b: { kind: 'value', required: true } } },
  not: { about: 'true when value is not.', args: { value: { kind: 'value', required: true } } },
  and: { about: 'true when every one of values is.', args: { values: { kind: 'values', required: true } } },
  or: { about: 'true when any one of values is.', args: { values: { kind: 'values', required: true } } },
  choose: { about: 'The one of "from" that "key" names; otherwise "otherwise".', args: { key: { kind: 'value', required: true }, from: { kind: 'map', required: true }, otherwise: { kind: 'value' } } },
  formatNumber: { about: 'A number with its thousands separated, to "decimals" places.', args: { value: { kind: 'value', required: true }, decimals: { kind: 'value' } } },
  formatCurrency: { about: 'An amount of money in "currency", to "decimals" places.', args: { value: { kind: 'value', required: true }, currency: { kind: 'value' }, decimals: { kind: 'value' } } },
  formatDate: { about: 'A day as DD-Mon-YYYY.', args: { value: { kind: 'value', required: true } } },
  formatString: { about: 'Text with values put in: "${/state/month}" or, in a table\'s row, "${item}".', args: { value: { kind: 'template', required: true } } },
} as const satisfies Record<string, FunctionSpec>
export type PageFunctionName = keyof typeof PAGE_FUNCTIONS

/** What an action's context key holds: text written out, one dynamic value, or a set of named dynamic values. */
type ContextKind = 'text' | 'value' | 'map'
interface ContextKey { kind: ContextKind; required?: true }
interface ActionSpec { about: string; context: Record<string, ContextKey> }

export const PAGE_ACTIONS = {
  save_row: {
    about: 'Change one row. It is the row\'s normal save, as the person looking: the Table\'s checks run, and it is refused if someone changed the row since it was read.',
    context: { table: { kind: 'text', required: true }, row: { kind: 'value', required: true }, updated_at: { kind: 'value', required: true }, values: { kind: 'map', required: true } },
  },
  create_row: {
    about: 'Add one row, as the person looking, with the Table\'s checks.',
    context: { table: { kind: 'text', required: true }, values: { kind: 'map', required: true } },
  },
  open_record: {
    about: 'Go to a row\'s own page.',
    context: { table: { kind: 'text', required: true }, row: { kind: 'value', required: true } },
  },
  open_page: {
    about: 'Go to another page, with the state it should open in.',
    context: { page: { kind: 'text', required: true }, state: { kind: 'map' } },
  },
  set_state: {
    about: 'Change this page\'s state.',
    context: { values: { kind: 'map', required: true } },
  },
} as const satisfies Record<string, ActionSpec>
export type PageActionName = keyof typeof PAGE_ACTIONS

/** The list API's filter operators a page's data source may use. */
export const PAGE_FILTER_OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'like', 'not like', 'in', 'not in', 'is blank', 'is not blank'] as const

// ---------------------------------------------------------------------------
// The checker.

/** A column a page reads or writes, and where in the definition it does so. */
export interface PageColumnUse { column: string; at: string }
export interface PageCheck {
  /** Every mistake, keyed by where it is ("components.plan.group_by"). Empty when the page is right. */
  fields: Record<string, string>
  /** For each Table a data source names: the columns the page reads from it, for the server to check against the Table. */
  tables: { source: string; table: string; at: string; columns: PageColumnUse[] }[]
  /** Each save_row and create_row on a Table written out: the columns it writes. */
  writes: { table: string; at: string; columns: PageColumnUse[] }[]
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const list = (names: readonly string[]) => names.join(', ')
const TOP = ['version', 'state', 'data', 'components']
const SOURCE_KEYS = ['table', 'filters', 'columns', 'order_by', 'limit']
const COLUMN_KEYS = ['id', 'header', 'value', 'cell', 'align', 'format', 'total', 'visible']
const COLUMN_CHOICES: Record<string, readonly string[]> = { align: ['start', 'end'], format: ['text', 'number', 'currency', 'date'], total: ['sum'] }
/** Where a part is drawn: at the top of the page, or once per row of a data source. */
const TOP_SCOPE = ''

export function checkPage(input: unknown): PageCheck {
  const fields: Record<string, string> = {}
  const say = (at: string, why: string) => { fields[at] ??= why }
  const done = (): PageCheck => ({ fields, tables: [], writes: [] })
  if (!isObject(input)) {
    say('definition', 'A page is an object with version, state, data and components')
    return done()
  }
  for (const key of Object.keys(input)) if (!TOP.includes(key)) say(key, `A page has no "${key}". It has: ${list(TOP)}`)
  if (input.version !== PAGE_SPEC_VERSION) say('version', `version must be "${PAGE_SPEC_VERSION}", the A2UI version the page is written in`)

  // --- state: named values with their defaults.
  const state = new Set<string>()
  if (input.state !== undefined && !isObject(input.state)) say('state', 'state is an object of names and their starting values')
  for (const [key, value] of Object.entries(isObject(input.state) ? input.state : {})) {
    if (!NAME.test(key)) say(`state.${key}`, 'A state name is letters, digits and _, starting with a letter')
    else if (!['string', 'number', 'boolean'].includes(typeof value)) say(`state.${key}`, 'A state value is text, a number, or true or false')
    else state.add(key)
  }

  // --- data: named sources of rows.
  /** A source's declared columns (a Table source that lists them), or the values its sample rows have. Null: any column. */
  const sources = new Map<string, { table?: string; known: Set<string> | null }>()
  /** Relative paths read in a source's rows, and a Table source's own filters, columns and order. */
  const reads = new Map<string, PageColumnUse[]>()
  const read = (source: string, column: string, at: string) => { reads.get(source)!.push({ column, at }) }
  /** Paths found before the scopes are known: checked once every part's place is. */
  const paths: { path: string; at: string; part: string | null; source: string | null }[] = []

  const usePath = (path: unknown, at: string, part: string | null, source: string | null) => {
    if (typeof path !== 'string' || !path) say(at, 'A path is text, such as "/state/measure" or, in a table\'s row, "item"')
    else paths.push({ path, at, part, source })
  }

  /** A dynamic value: a literal of the wanted type, a {"@path"} or a {"@call"}. */
  const dynamic = (value: unknown, want: Kind, at: string, part: string | null, source: string | null): void => {
    if (isObject(value) && '@path' in value) {
      for (const key of Object.keys(value)) if (key !== '@path') say(`${at}.${key}`, 'A {"@path"} holds nothing else')
      return usePath(value['@path'], at, part, source)
    }
    if (isObject(value) && '@call' in value) return call(value, at, part, source)
    const fits = want === 'value' ? value === null || ['string', 'number', 'boolean'].includes(typeof value) : typeof value === want
    if (!fits) say(at, `Expected ${KIND_WORDS[want]}`)
  }

  const call = (value: Json, at: string, part: string | null, source: string | null) => {
    const name = value['@call']
    const spec = (PAGE_FUNCTIONS as Record<string, FunctionSpec>)[String(name)]
    if (!spec) return say(at, `There is no function "${String(name)}". The functions are: ${list(Object.keys(PAGE_FUNCTIONS))}`)
    for (const key of Object.keys(value)) if (key !== '@call' && key !== 'args') say(`${at}.${key}`, 'A {"@call"} holds "args" and nothing else')
    const args = isObject(value.args) ? value.args : {}
    if (value.args !== undefined && !isObject(value.args)) say(`${at}.args`, 'args is an object of named values')
    for (const key of Object.keys(args)) if (!(key in spec.args)) say(`${at}.args.${key}`, `${String(name)} has no "${key}". It takes: ${list(Object.keys(spec.args))}`)
    for (const [key, arg] of Object.entries(spec.args)) {
      const given = args[key]
      const where = `${at}.args.${key}`
      if (given === undefined) {
        if (arg.required) say(where, `${String(name)} needs "${key}"`)
      } else if (arg.kind === 'values') {
        if (!Array.isArray(given)) say(where, 'Expected a list of values')
        else given.forEach((each, i) => dynamic(each, 'value', `${where}.${i}`, part, source))
      } else if (arg.kind === 'map') many(given, where, part, source)
      else if (arg.kind === 'template' && typeof given === 'string') {
        for (const found of given.matchAll(/\$\{([^}]*)\}/g)) usePath(found[1], where, part, source)
      } else dynamic(given, arg.kind === 'template' ? 'string' : 'value', where, part, source)
    }
  }

  /** A set of named dynamic values. Answers its names. */
  const many = (value: unknown, at: string, part: string | null, source: string | null): string[] => {
    if (!isObject(value)) {
      say(at, 'Expected an object of named values')
      return []
    }
    for (const [key, each] of Object.entries(value)) dynamic(each, 'value', `${at}.${key}`, part, source)
    return Object.keys(value)
  }

  if (input.data !== undefined && !isObject(input.data)) say('data', 'data is an object of named sources of rows')
  for (const [name, source] of Object.entries(isObject(input.data) ? input.data : {})) {
    const at = `data.${name}`
    if (!NAME.test(name)) say(at, 'A source name is letters, digits and _, starting with a letter')
    else if (!isObject(source)) say(at, 'A source is {"table": ...} or {"sample": [...]}')
    else if ('sample' in source) {
      for (const key of Object.keys(source)) if (key !== 'sample') say(`${at}.${key}`, 'A sample source holds "sample" and nothing else')
      const rows = source.sample
      if (!Array.isArray(rows) || !rows.every(isObject)) say(`${at}.sample`, 'sample is a list of rows, each an object of column names and values')
      else {
        sources.set(name, { known: new Set((rows as Json[]).flatMap((row) => Object.keys(row))) })
        reads.set(name, [])
      }
    } else {
      for (const key of Object.keys(source)) if (!SOURCE_KEYS.includes(key)) say(`${at}.${key}`, `A Table source has no "${key}". It has: ${list(SOURCE_KEYS)}`)
      if (typeof source.table !== 'string' || !source.table) {
        say(`${at}.table`, 'A source names its Table, or holds sample rows')
        continue
      }
      const columns = source.columns
      const listed = Array.isArray(columns) && columns.every((column) => typeof column === 'string' && column)
      if (columns !== undefined && !listed) say(`${at}.columns`, 'columns is a list of column names')
      sources.set(name, { table: source.table, known: listed ? new Set([...(columns as string[]), ...PAGE_ROW_COLUMNS]) : null })
      reads.set(name, [])
      if (listed) (columns as string[]).forEach((column, i) => read(name, column, `${at}.columns.${i}`))
      if (source.filters !== undefined && !Array.isArray(source.filters)) say(`${at}.filters`, 'filters is a list of [column, operator, value]')
      for (const [i, filter] of (Array.isArray(source.filters) ? source.filters : []).entries()) {
        const where = `${at}.filters.${i}`
        if (!Array.isArray(filter) || filter.length !== 3 || typeof filter[0] !== 'string') say(where, 'A filter is [column, operator, value]')
        else if (!(PAGE_FILTER_OPERATORS as readonly string[]).includes(filter[1])) say(where, `The operators are: ${list(PAGE_FILTER_OPERATORS)}`)
        else {
          read(name, filter[0], where)
          // A filter's value is the list API's own, or a value of the page's state.
          if (isObject(filter[2])) dynamic(filter[2], 'value', `${where}.2`, null, null)
        }
      }
      if (source.order_by !== undefined) {
        const order = typeof source.order_by === 'string' ? /^(\S+) (asc|desc)$/.exec(source.order_by) : null
        if (!order) say(`${at}.order_by`, 'order_by is "column asc" or "column desc"')
        else read(name, order[1]!, `${at}.order_by`)
      }
      const limit = source.limit
      if (limit !== undefined && !(Number.isInteger(limit) && (limit as number) >= 1 && (limit as number) <= PAGE_ROW_CAP))
        say(`${at}.limit`, `limit is a whole number from 1 to ${PAGE_ROW_CAP}`)
    }
  }

  // --- components: the parts, in a flat list.
  const parts = new Map<string, PagePart>()
  /** Ids a part goes by whose part is itself wrong: named once, where the part is, never again where it is used. */
  const wrong = new Set<string>()
  if (!Array.isArray(input.components) || input.components.length === 0) {
    say('components', 'components is the list of the page\'s parts, one of them with the id "root"')
    return done()
  }
  for (const [i, part] of input.components.entries()) {
    const at = `components.${i}`
    if (!isObject(part)) say(at, 'A part is an object with an id and a component')
    else if (typeof part.id !== 'string' || !NAME.test(part.id)) say(`${at}.id`, 'A part\'s id is letters, digits and _, starting with a letter')
    else if (parts.has(part.id)) say(`components.${part.id}.id`, `Two parts have the id "${part.id}"`)
    else if (!(String(part.component) in PAGE_PARTS)) {
      wrong.add(part.id)
      say(`components.${part.id}.component`, `There is no part "${String(part.component)}". The parts are: ${list(Object.keys(PAGE_PARTS))}`)
    } else parts.set(part.id, part as PagePart)
  }

  /** Which part draws which: `source` set when the child is drawn once per row of that source. */
  const edges: { from: string; to: string; source: string | null; at: string }[] = []
  const writes: PageCheck['writes'] = []
  const child = (from: string, to: unknown, at: string, source: string | null) => {
    if (typeof to === 'string' && parts.has(to)) edges.push({ from, to, source, at })
    else if (!wrong.has(to as string)) say(at, `There is no part with the id "${String(to)}"`)
  }
  /** The source a {"@path": "/data/<source>"} names, when it is exactly that. */
  const sourceOf = (value: unknown): string | null => {
    const found = isObject(value) && typeof value['@path'] === 'string' ? /^\/data\/([^/]+)$/.exec(value['@path']) : null
    return found && sources.has(found[1]!) ? found[1]! : null
  }

  for (const [id, part] of parts) {
    const spec = (PAGE_PARTS as Record<string, PartSpec>)[part.component]!
    const at = `components.${id}`
    for (const key of Object.keys(part))
      if (key !== 'id' && key !== 'component' && !(key in spec.settings))
        say(`${at}.${key}`, `${part.component} has no setting "${key}". Its settings: ${list(Object.keys(spec.settings))}`)
    // A Table's columns and its group are read in the rows of its own source.
    const rows = part.component === 'Table' ? sourceOf(part.rows) : null
    for (const [key, setting] of Object.entries(spec.settings)) {
      const value = part[key]
      const where = `${at}.${key}`
      if (value === undefined) {
        if (setting.required) say(where, `${part.component} needs "${key}": ${setting.about}`)
        continue
      }
      switch (setting.kind) {
        case 'text':
          if (typeof value !== 'string' || !value) say(where, 'Expected text, written out')
          else if (setting.values && !setting.values.includes(value)) say(where, `Expected one of: ${list(setting.values)}`)
          else if (key === 'group_by' && rows) read(rows, value, where)
          else if (key === 'row_key' && rows) read(rows, value, where)
          break
        case 'bound':
          if (!isObject(value) || typeof value['@path'] !== 'string') say(where, `Expected ${KIND_WORDS.bound}`)
          else if (key === 'rows' && !rows) say(where, 'A table\'s rows are {"@path": "/data/<source>"}, naming a source in data')
          else if (key === 'open' && !/^\/state\//.test(value['@path'])) say(where, 'open is a {"@path": "/state/<key>"}')
          else dynamic(value, 'value', where, id, null)
          break
        case 'children':
          if (Array.isArray(value)) value.forEach((each, i) => child(id, each, `${where}.${i}`, null))
          else if (isObject(value) && sourceOf({ '@path': value.path })) child(id, value.componentId, `${where}.componentId`, sourceOf({ '@path': value.path }))
          else say(where, `Expected ${KIND_WORDS.children}, where path is "/data/<source>"`)
          break
        case 'options':
          if (!Array.isArray(value) || value.length === 0 || !value.every((option) => isObject(option) && typeof option.value === 'string' && typeof option.label === 'string'))
            say(where, 'Expected a list of {"value", "label"}, both text')
          break
        case 'action': {
          const event = isObject(value) && isObject(value.event) ? value.event : null
          const action = event ? (PAGE_ACTIONS as Record<string, ActionSpec>)[String(event.name)] : undefined
          if (!event) say(where, `Expected ${KIND_WORDS.action}`)
          else if (!action) say(`${where}.event.name`, `There is no action "${String(event.name)}". The actions are: ${list(Object.keys(PAGE_ACTIONS))}`)
          else {
            const context = isObject(event.context) ? event.context : {}
            const here = `${where}.event.context`
            for (const name of Object.keys(context)) if (!(name in action.context)) say(`${here}.${name}`, `${String(event.name)} has no "${name}". It takes: ${list(Object.keys(action.context))}`)
            let written: string[] = []
            for (const [name, key] of Object.entries(action.context)) {
              const given = context[name]
              if (given === undefined) {
                if (key.required) say(`${here}.${name}`, `${String(event.name)} needs "${name}"`)
              } else if (key.kind === 'text') {
                if (typeof given !== 'string' || !given) say(`${here}.${name}`, 'Expected text, written out')
              } else if (key.kind === 'map') {
                const names = many(given, `${here}.${name}`, id, null)
                if (event.name === 'set_state') for (const each of names) if (!state.has(each)) say(`${here}.${name}.${each}`, `There is no state "${each}". Name it in state, with its starting value`)
                if (name === 'values') written = names
              } else dynamic(given, 'value', `${here}.${name}`, id, null)
            }
            if ((event.name === 'save_row' || event.name === 'create_row') && typeof context.table === 'string' && context.table)
              writes.push({ table: context.table, at: here, columns: written.map((column) => ({ column, at: `${here}.values.${column}` })) })
          }
          break
        }
        case 'columns': {
          if (!Array.isArray(value) || value.length === 0) {
            say(where, 'A table has at least one column')
            break
          }
          const ids = new Set<string>()
          for (const [i, column] of value.entries()) {
            const here = `${where}.${i}`
            if (!isObject(column) || typeof column.id !== 'string' || !NAME.test(column.id)) {
              say(here, 'A column is an object with an id: letters, digits and _, starting with a letter')
              continue
            }
            if (ids.has(column.id)) say(`${here}.id`, `Two columns have the id "${column.id}"`)
            ids.add(column.id)
            for (const key of Object.keys(column)) if (!COLUMN_KEYS.includes(key)) say(`${here}.${key}`, `A column has no "${key}". It has: ${list(COLUMN_KEYS)}`)
            if (column.header === undefined) say(`${here}.header`, 'A column needs a header')
            else dynamic(column.header, 'string', `${here}.header`, id, null)
            if (column.value === undefined && column.cell === undefined) say(here, 'A column needs a value (what a row shows) or a cell (a part drawn in each row)')
            if (column.value !== undefined) dynamic(column.value, 'value', `${here}.value`, id, rows)
            if (column.cell !== undefined) child(id, column.cell, `${here}.cell`, rows)
            if (column.visible !== undefined) dynamic(column.visible, 'boolean', `${here}.visible`, id, null)
            for (const [key, choices] of Object.entries(COLUMN_CHOICES))
              if (column[key] !== undefined && !choices.includes(column[key] as string)) say(`${here}.${key}`, `Expected one of: ${list(choices)}`)
            if (column.total !== undefined && column.value === undefined) say(`${here}.total`, 'A total adds up the column\'s value, so the column needs a value')
          }
          break
        }
        case 'bands': {
          const order = Array.isArray(part.columns) ? part.columns.map((column) => (isObject(column) ? column.id : undefined)) : []
          const taken = new Set<unknown>()
          if (!Array.isArray(value)) {
            say(where, `Expected ${KIND_WORDS.bands}`)
            break
          }
          for (const [i, band] of value.entries()) {
            const here = `${where}.${i}`
            if (!isObject(band) || typeof band.label !== 'string' || !Array.isArray(band.columns) || band.columns.length === 0) {
              say(here, 'A band is {"label", "columns"}: text, and the ids of the columns it spans')
              continue
            }
            const places = band.columns.map((column) => order.indexOf(column))
            if (places.includes(-1)) say(`${here}.columns`, `A band names columns of this table. Its columns: ${list(order.map(String))}`)
            else if (band.columns.some((column) => taken.has(column))) say(`${here}.columns`, 'A column sits under one band only')
            else if (places.some((place, at) => at > 0 && place !== places[at - 1]! + 1)) say(`${here}.columns`, 'A band\'s columns sit next to each other, in the table\'s order')
            band.columns.forEach((column) => taken.add(column))
          }
          break
        }
        default:
          dynamic(value, setting.kind, where, id, null)
      }
    }
    if (part.component === 'Table' && part.open !== undefined && part.group_by === undefined) say(`${at}.open`, 'open goes with group_by: it holds which group is open')
  }

  // --- the tree: one root, a Page; every part drawn by one other; no part drawing itself.
  const root = parts.get('root')
  if (!root) say('components', 'One part has the id "root", and it is a Page')
  else if (root.component !== 'Page') say('components.root.component', 'The part with the id "root" is a Page')
  for (const [id, part] of parts) if (id !== 'root' && part.component === 'Page') say(`components.${id}.component`, 'A Page is the part with the id "root", and only that one')
  /** Where each part is drawn: the top of the page, the rows of a source, or both. */
  const scopes = new Map<string, Set<string>>([['root', new Set([TOP_SCOPE])]])
  const walk = (id: string, trail: string[]) => {
    for (const edge of edges.filter((each) => each.from === id)) {
      if (trail.includes(edge.to)) {
        say(edge.at, `"${edge.to}" would be drawn inside itself`)
        continue
      }
      const before = scopes.get(edge.to)?.size ?? 0
      const into = scopes.get(edge.to) ?? new Set<string>()
      for (const scope of edge.source === null ? scopes.get(id)! : [edge.source]) into.add(scope)
      scopes.set(edge.to, into)
      if (into.size > before) walk(edge.to, [...trail, edge.to])
    }
  }
  if (root) walk('root', ['root'])
  if (root) for (const id of parts.keys()) if (!scopes.has(id)) say(`components.${id}`, `No part draws "${id}". Name it in a part's children, or in a column's cell`)

  // --- paths, now that every part's place is known.
  for (const { path, at, part, source } of paths) {
    if (path.startsWith('/')) {
      const [, area, name, ...rest] = path.split('/')
      if (area === 'state' && rest.length === 0) {
        if (!state.has(name!)) say(at, `There is no state "${name}". Name it in state, with its starting value`)
      } else if (area === 'data') {
        if (!sources.has(name!)) say(at, `There is no data source "${name}". Name it in data`)
      } else say(at, 'A path from the top is "/state/<name>" or "/data/<source>"')
      continue
    }
    const places = source !== null ? [source] : part !== null ? [...(scopes.get(part) ?? [])] : [TOP_SCOPE]
    const column = path.split('/')[0]!
    for (const place of places) {
      if (place === TOP_SCOPE) say(at, `"${path}" is read from a row, but this is not inside a table's row. A path from the top starts with "/"`)
      else {
        const known = sources.get(place)!.known
        if (known && !known.has(column)) say(at, sources.get(place)!.table ? `"${column}" is not among data.${place}.columns` : `The sample rows of "${place}" have no "${column}"`)
        else read(place, column, at)
      }
    }
  }

  const tables = [...sources].flatMap(([source, { table }]) => (table ? [{ source, table, at: `data.${source}.table`, columns: reads.get(source)! }] : []))
  return { fields, tables, writes }
}

// ---------------------------------------------------------------------------
// The catalog, as an agent reads it.

/** The worked example: a reorder plan over a made-up Table, "Reorder Line". */
export const PAGE_EXAMPLE: PageDefinition = {
  version: PAGE_SPEC_VERSION,
  state: { measure: 'quantity', open: '' },
  data: { lines: { table: 'Reorder Line', filters: [['month', '=', '2026-12']], order_by: 'category asc' } },
  components: [
    { id: 'root', component: 'Page', title: 'Reorder Plan, December', actions: ['measure'], children: ['plan'] },
    {
      id: 'measure', component: 'Toggle', label: 'Show',
      options: [{ value: 'value', label: 'Value' }, { value: 'quantity', label: 'Quantity' }],
      value: { '@path': '/state/measure' },
    },
    {
      id: 'plan', component: 'Table', caption: 'Reorder plan', rows: { '@path': '/data/lines' },
      group_by: 'category', open: { '@path': '/state/open' },
      bands: [{ label: 'Last Month', columns: ['sold', 'returned'] }, { label: 'Next Month', columns: ['suggested', 'planned'] }],
      columns: [
        { id: 'item', header: 'Category', cell: 'item_link' },
        { id: 'sold', header: 'Sold', align: 'end', format: 'number', total: 'sum', value: { '@call': 'choose', args: { key: { '@path': '/state/measure' }, from: { value: { '@path': 'sold_value' }, quantity: { '@path': 'sold_qty' } } } } },
        { id: 'returned', header: 'Returned', align: 'end', format: 'number', total: 'sum', value: { '@call': 'choose', args: { key: { '@path': '/state/measure' }, from: { value: { '@path': 'returned_value' }, quantity: { '@path': 'returned_qty' } } } } },
        { id: 'suggested', header: 'Suggested', align: 'end', format: 'number', total: 'sum', value: { '@call': 'choose', args: { key: { '@path': '/state/measure' }, from: { value: { '@path': 'suggested_value' }, quantity: { '@path': 'suggested_qty' } } } } },
        { id: 'planned', header: 'Planned', format: 'number', total: 'sum', value: { '@path': 'planned_qty' }, cell: 'plan_cell' },
      ],
    },
    { id: 'item_link', component: 'RecordLink', table: 'Reorder Line', row: { '@path': 'row_id' }, label: { '@path': 'item' } },
    { id: 'plan_cell', component: 'Row', children: ['plan_input', 'plan_save', 'plan_accept'] },
    { id: 'plan_input', component: 'Input', label: 'Planned quantity', kind: 'number', value: { '@path': 'planned_qty' } },
    {
      id: 'plan_save', component: 'Button', label: 'Save',
      action: { event: { name: 'save_row', context: { table: 'Reorder Line', row: { '@path': 'row_id' }, updated_at: { '@path': 'updated_at' }, values: { planned_qty: { '@path': 'planned_qty' } } } } },
    },
    {
      id: 'plan_accept', component: 'Button', label: 'Accept Suggested', variant: 'quiet',
      action: { event: { name: 'save_row', context: { table: 'Reorder Line', row: { '@path': 'row_id' }, updated_at: { '@path': 'updated_at' }, values: { planned_qty: { '@path': 'suggested_qty' } } } } },
    },
  ],
}

/** What an agent reads before it writes a page: every part, function and action, and one page that works. */
export function pageCatalog() {
  const settings = (spec: PartSpec) => Object.fromEntries(Object.entries(spec.settings).map(([name, setting]) => [name, {
    holds: setting.values ? `one of: ${list(setting.values)}` : KIND_WORDS[setting.kind],
    required: setting.required === true,
    about: setting.about,
  }]))
  return {
    about: 'A page is a screen saved as data and drawn inside Featherbase. Its definition has four keys. '
      + 'version: "1.0". state: named values with their starting values, kept in the page\'s address. '
      + 'data: named sources of rows, each {"table", "filters", "columns", "order_by", "limit"} read as the person looking, or {"sample": [rows]} written in the page. '
      + 'components: the parts, in a flat list, each with an id and a component; a part names its children by id. '
      + 'A setting reads a value with {"@path": "/state/<name>"} or {"@path": "/data/<source>"}; inside a table\'s row, a path with no leading "/" reads that row ({"@path": "item"}). '
      + 'A page has no arithmetic: a number comes from the data, or from a column\'s total.',
    version: PAGE_SPEC_VERSION,
    rowCap: PAGE_ROW_CAP,
    parts: Object.fromEntries(Object.entries(PAGE_PARTS).map(([name, spec]) => [name, { about: spec.about, settings: settings(spec) }])),
    functions: Object.fromEntries(Object.entries(PAGE_FUNCTIONS).map(([name, spec]) => [name, {
      about: spec.about,
      use: `{"@call": "${name}", "args": {${Object.keys(spec.args).map((arg) => `"${arg}": ...`).join(', ')}}}`,
      required: Object.entries(spec.args).filter(([, arg]) => 'required' in arg).map(([arg]) => arg),
    }])),
    actions: Object.fromEntries(Object.entries(PAGE_ACTIONS).map(([name, spec]) => [name, {
      about: spec.about,
      use: `{"event": {"name": "${name}", "context": {${Object.keys(spec.context).map((key) => `"${key}": ...`).join(', ')}}}}`,
      required: Object.entries(spec.context).filter(([, key]) => 'required' in key).map(([key]) => key),
    }])),
    filterOperators: PAGE_FILTER_OPERATORS,
    example: PAGE_EXAMPLE,
  }
}
