// #1410: the page checker and the catalog. A page is checked as a whole and
// every mistake is reported, keyed by where it is.
import { describe, expect, test } from 'vitest'
import {
  PAGE_ACTIONS, PAGE_EXAMPLE, PAGE_FUNCTIONS, PAGE_NAME, PAGE_PARTS, PAGE_ROW_CAP, checkPage, pageCatalog, pageHref,
  type PagePart,
} from '../src/page-definition'

type Json = Record<string, unknown>
const text = (id: string, more: Json = {}): PagePart => ({ id, component: 'Text', text: 'Hello', ...more })
/** A right page: a heading over the parts given, with their ids as its children. */
const page = (parts: PagePart[] = [text('hello')], more: Json = {}) => ({
  version: '1.0',
  components: [{ id: 'root', component: 'Page', title: 'Reorder Plan', children: parts.filter((p) => !p.inner).map((p) => p.id) }, ...parts.map(({ inner: _inner, ...part }) => part)],
  ...more,
})
const lines = { lines: { table: 'Reorder Line' } }
const table = (more: Json = {}): PagePart => ({
  id: 'plan', component: 'Table', caption: 'Plan', rows: { '@path': '/data/lines' },
  columns: [{ id: 'item', header: 'Item', value: { '@path': 'item' } }], ...more,
})
const fields = (input: unknown) => checkPage(input).fields
const button = (event: Json, more: Json = {}): PagePart => ({ id: 'go', component: 'Button', label: 'Go', action: { event }, ...more })

describe('a right page', () => {
  test('the smallest page has no mistakes', () => {
    expect(checkPage(page())).toEqual({ fields: {}, tables: [], writes: [] })
  })

  test('the worked example is right, and says which columns it reads and writes', () => {
    const check = checkPage(PAGE_EXAMPLE)
    expect(check.fields).toEqual({})
    expect(check.tables).toHaveLength(1)
    expect(check.tables[0]).toMatchObject({ source: 'lines', table: 'Reorder Line', at: 'data.lines.table' })
    expect(new Set(check.tables[0]!.columns.map((use) => use.column))).toEqual(new Set([
      'month', 'category', 'sold_value', 'sold_qty', 'returned_value', 'returned_qty', 'suggested_value', 'suggested_qty', 'planned_qty', 'row_id', 'item', 'updated_at',
    ]))
    expect(check.writes).toEqual([
      { table: 'Reorder Line', at: 'components.plan_save.action.event.context', columns: [{ column: 'planned_qty', at: 'components.plan_save.action.event.context.values.planned_qty' }] },
      { table: 'Reorder Line', at: 'components.plan_accept.action.event.context', columns: [{ column: 'planned_qty', at: 'components.plan_accept.action.event.context.values.planned_qty' }] },
    ])
  })

  test('a page\'s name is lower-case words joined by hyphens, and its address follows', () => {
    expect(PAGE_NAME.test('reorder-plan')).toBe(true)
    for (const wrong of ['Reorder Plan', 'reorder_plan', '-plan', 'plan-', '9plan']) expect(PAGE_NAME.test(wrong)).toBe(false)
    expect(pageHref('reorder-plan')).toBe('/featherbase/admin/page/reorder-plan')
  })
})

describe('the envelope', () => {
  test('a page that is not an object is refused outright', () => {
    for (const wrong of [null, 'page', [], 7]) expect(fields(wrong)).toEqual({ definition: 'A page is an object with version, state, data and components' })
  })

  test('an unknown key and a wrong version are both named', () => {
    expect(fields({ ...page(), version: '0.9', theme: {} })).toEqual({
      theme: 'A page has no "theme". It has: version, state, data, components',
      version: 'version must be "1.0", the A2UI version the page is written in',
    })
  })

  test('no parts, or parts that are not a list, are refused before anything else is checked', () => {
    const why = { components: 'components is the list of the page\'s parts, one of them with the id "root"' }
    expect(fields({ version: '1.0', components: [] })).toEqual(why)
    expect(fields({ version: '1.0' })).toEqual(why)
    expect(checkPage({ version: '1.0', components: 'root' })).toEqual({ fields: why, tables: [], writes: [] })
  })

  test('state is named values: text, a number, or true or false', () => {
    expect(fields(page(undefined, { state: [] }))).toEqual({ state: 'state is an object of names and their starting values' })
    expect(fields(page(undefined, { state: { measure: 'value', count: 3, open: false, 'my key': 'x', nothing: null } }))).toEqual({
      'state.my key': 'A state name is letters, digits and _, starting with a letter',
      'state.nothing': 'A state value is text, a number, or true or false',
    })
  })
})

describe('data sources', () => {
  test('data is named sources, each a Table or sample rows', () => {
    expect(fields(page(undefined, { data: 'lines' }))).toEqual({ data: 'data is an object of named sources of rows' })
    expect(fields(page(undefined, { data: { 'my lines': {}, lines: 'Reorder Line', none: {} } }))).toEqual({
      'data.my lines': 'A source name is letters, digits and _, starting with a letter',
      'data.lines': 'A source is {"table": ...} or {"sample": [...]}',
      'data.none.table': 'A source names its Table, or holds sample rows',
    })
  })

  test('a Table source\'s settings are each checked', () => {
    const source = (more: Json) => fields(page(undefined, { data: { lines: { table: 'Reorder Line', ...more } } }))
    expect(source({ where: [] })).toEqual({ 'data.lines.where': 'A Table source has no "where". It has: table, filters, columns, order_by, limit' })
    expect(source({ columns: 'item' })).toEqual({ 'data.lines.columns': 'columns is a list of column names' })
    expect(source({ columns: ['item', ''] })).toEqual({ 'data.lines.columns': 'columns is a list of column names' })
    expect(source({ filters: {} })).toEqual({ 'data.lines.filters': 'filters is a list of [column, operator, value]' })
    expect(source({ filters: [['month', '='], [7, '=', 1], 'month', ['month', 'near', 1]] })).toEqual({
      'data.lines.filters.0': 'A filter is [column, operator, value]',
      'data.lines.filters.1': 'A filter is [column, operator, value]',
      'data.lines.filters.2': 'A filter is [column, operator, value]',
      'data.lines.filters.3': 'The operators are: =, !=, >, <, >=, <=, like, not like, in, not in, is blank, is not blank',
    })
    expect(source({ order_by: 'category' })).toEqual({ 'data.lines.order_by': 'order_by is "column asc" or "column desc"' })
    expect(source({ order_by: 7 })).toEqual({ 'data.lines.order_by': 'order_by is "column asc" or "column desc"' })
    for (const limit of [0, 1.5, PAGE_ROW_CAP + 1, '10']) expect(source({ limit })).toEqual({ 'data.lines.limit': 'limit is a whole number from 1 to 500' })
    expect(source({ limit: PAGE_ROW_CAP, order_by: 'category desc', columns: ['item'], filters: [['month', 'in', ['2026-12']]] })).toEqual({})
  })

  test('a filter\'s value may be a value of the page\'s state, and nothing from a row', () => {
    const filtered = (value: unknown) => fields(page(undefined, { state: { month: '2026-12' }, data: { lines: { table: 'Reorder Line', filters: [['month', '=', value]] } } }))
    expect(filtered({ '@path': '/state/month' })).toEqual({})
    expect(filtered({ '@path': '/state/year' })).toEqual({ 'data.lines.filters.0.2': 'There is no state "year". Name it in state, with its starting value' })
    expect(filtered({ '@path': 'month' })).toEqual({ 'data.lines.filters.0.2': '"month" is read from a row, but this is not inside a table\'s row. A path from the top starts with "/"' })
    expect(filtered({ month: 12 })).toEqual({ 'data.lines.filters.0.2': 'Expected any value, a {"@path"} or a {"@call"}' })
  })

  test('a Table source says which columns its filters, list and order name', () => {
    const check = checkPage(page(undefined, { data: { lines: { table: 'Reorder Line', columns: ['item'], filters: [['month', '=', '2026-12']], order_by: 'category asc' } } }))
    expect(check.tables).toEqual([{
      source: 'lines', table: 'Reorder Line', at: 'data.lines.table',
      columns: [{ column: 'item', at: 'data.lines.columns.0' }, { column: 'month', at: 'data.lines.filters.0' }, { column: 'category', at: 'data.lines.order_by' }],
    }])
  })

  test('a sample source holds rows and nothing else', () => {
    expect(fields(page(undefined, { data: { demo: { sample: [{ item: 'Notebook A5' }], table: 'Reorder Line' } } }))).toEqual({ 'data.demo.table': 'A sample source holds "sample" and nothing else' })
    for (const sample of ['rows', [['Notebook A5']]])
      expect(fields(page(undefined, { data: { demo: { sample } } }))).toEqual({ 'data.demo.sample': 'sample is a list of rows, each an object of column names and values' })
    expect(checkPage(page(undefined, { data: { demo: { sample: [{ item: 'Notebook A5' }] } } }))).toEqual({ fields: {}, tables: [], writes: [] })
  })

  test('a row\'s value must be one the source has: among a Table source\'s listed columns, or in the sample rows', () => {
    const reading = (data: Json) => fields(page([{ ...table({ columns: [{ id: 'item', header: 'Item', value: { '@path': 'itm' } }, { id: 'id', header: 'Id', value: { '@path': 'row_id' } }] }) }], { data }))
    expect(reading({ lines: { table: 'Reorder Line', columns: ['item'] } })).toEqual({ 'components.plan.columns.0.value': '"itm" is not among data.lines.columns' })
    expect(reading({ lines: { sample: [{ item: 'Notebook A5', row_id: 'L1' }] } })).toEqual({ 'components.plan.columns.0.value': 'The sample rows of "lines" have no "itm"' })
    expect(reading({ lines: { table: 'Reorder Line' } })).toEqual({})
  })
})

describe('parts', () => {
  test('each part is an object with an id of its own and a component there is', () => {
    const input = { version: '1.0', components: [
      { id: 'root', component: 'Page', title: 'Plan', children: ['hello'] }, text('hello'), 'text', { component: 'Text' }, { id: 'my text', component: 'Text' },
      text('hello'), { id: 'spark', component: 'Sparkline' }, { id: 'none' },
    ] }
    expect(fields(input)).toEqual({
      'components.2': 'A part is an object with an id and a component',
      'components.3.id': 'A part\'s id is letters, digits and _, starting with a letter',
      'components.4.id': 'A part\'s id is letters, digits and _, starting with a letter',
      'components.hello.id': 'Two parts have the id "hello"',
      'components.spark.component': 'There is no part "Sparkline". The parts are: Page, Stack, Row, Text, Notice, RecordLink, Table, Toggle, Input, Button',
      'components.none.component': 'There is no part "undefined". The parts are: Page, Stack, Row, Text, Notice, RecordLink, Table, Toggle, Input, Button',
    })
  })

  test('an unknown setting, a missing one and a wrong value are named on the same part', () => {
    expect(fields(page([{ id: 'hello', component: 'Text', colour: 'red', variant: 'huge' }]))).toEqual({
      'components.hello.colour': 'Text has no setting "colour". Its settings: text, variant',
      'components.hello.text': 'Text needs "text": What it says.',
      'components.hello.variant': 'Expected one of: body, heading, caption, figure',
    })
    expect(fields(page([text('hello', { variant: 7 }), text('other', { text: 7 })]))).toEqual({
      'components.hello.variant': 'Expected text, written out',
      'components.other.text': 'Expected text, a {"@path"} or a {"@call"}',
    })
  })

  test('A2UI settings Featherbase does not draw are refused, not ignored', () => {
    expect(fields(page([text('hello', { '@checks': [], '@accessibility': {} })]))).toEqual({
      'components.hello.@checks': 'Text has no setting "@checks". Its settings: text, variant',
      'components.hello.@accessibility': 'Text has no setting "@accessibility". Its settings: text, variant',
    })
  })

  test('the root is a Page, and a Page is only the root', () => {
    expect(fields({ version: '1.0', components: [text('hello')] })).toEqual({ components: 'One part has the id "root", and it is a Page' })
    expect(fields({ version: '1.0', components: [{ id: 'root', component: 'Text', text: 'Hello' }] })).toEqual({ 'components.root.component': 'The part with the id "root" is a Page' })
    expect(fields(page([{ id: 'inner', component: 'Page', title: 'Inner', children: [] }]))).toEqual({ 'components.inner.component': 'A Page is the part with the id "root", and only that one' })
  })

  test('a child that is not there, a part nothing draws and a part drawn inside itself are each named', () => {
    const input = page([{ id: 'box', component: 'Stack', children: ['ghost', 7, 'again'] }, { id: 'again', component: 'Row', children: ['box'], inner: true }, { ...text('alone'), inner: true }])
    expect(fields(input)).toEqual({
      'components.box.children.0': 'There is no part with the id "ghost"',
      'components.box.children.1': 'There is no part with the id "7"',
      'components.again.children.0': '"box" would be drawn inside itself',
      'components.alone': 'No part draws "alone". Name it in a part\'s children, or in a column\'s cell',
    })
  })

  test('children are a list of ids, or one part repeated over a source\'s rows', () => {
    const repeated = (children: unknown) => fields(page([{ id: 'box', component: 'Stack', children }, { ...text('line', { text: { '@path': 'item' } }), inner: true }], { data: lines }))
    expect(repeated({ componentId: 'line', path: '/data/lines' })).toEqual({})
    expect(repeated({ componentId: 'ghost', path: '/data/lines' })).toMatchObject({ 'components.box.children.componentId': 'There is no part with the id "ghost"' })
    const wrong = 'Expected a list of part ids, or {"componentId", "path"} to repeat one part over rows, where path is "/data/<source>"'
    expect(repeated({ componentId: 'line', path: '/data/orders' })).toMatchObject({ 'components.box.children': wrong })
    expect(repeated({ componentId: 'line', path: 7 })).toMatchObject({ 'components.box.children': wrong })
    expect(repeated('line')).toMatchObject({ 'components.box.children': wrong })
  })

  test('a part drawn both at the top and in a row may not read from a row', () => {
    const shared = { ...text('line', { text: { '@path': 'item' } }), inner: true }
    const input = page([{ id: 'box', component: 'Stack', children: ['line'] }, { id: 'rows', component: 'Stack', children: { componentId: 'line', path: '/data/lines' } }, shared], { data: lines })
    expect(fields(input)).toEqual({ 'components.line.text': '"item" is read from a row, but this is not inside a table\'s row. A path from the top starts with "/"' })
    expect(checkPage(input).tables[0]!.columns).toEqual([{ column: 'item', at: 'components.line.text' }])
  })

  test('a part two parts draw in the same place is drawn twice, and is right', () => {
    const input = page([{ id: 'box', component: 'Stack', children: ['line', 'line'] }, { id: 'again', component: 'Row', children: ['line'] }, { ...text('line'), inner: true }])
    expect(fields(input)).toEqual({})
  })

  test('options are a list of values and labels', () => {
    const toggle = (options: unknown) => fields(page([{ id: 'measure', component: 'Toggle', label: 'Show', options, value: { '@path': '/state/measure' } }], { state: { measure: 'value' } }))
    for (const wrong of ['value', [], [{ value: 'value' }], [{ value: 1, label: 'One' }], ['value']])
      expect(toggle(wrong)).toEqual({ 'components.measure.options': 'Expected a list of {"value", "label"}, both text' })
    expect(toggle([{ value: 'value', label: 'Value' }])).toEqual({})
  })
})

describe('paths and functions', () => {
  test('a path from the top names a state or a source there is', () => {
    const reading = (path: unknown, more: Json = {}) => fields(page([text('hello', { text: { '@path': path, ...more } })], { state: { measure: 'value' }, data: lines }))
    expect(reading('/state/measure')).toEqual({})
    expect(reading('/data/lines')).toEqual({})
    expect(reading('/data/lines/0/item')).toEqual({})
    expect(reading('/state/mesure')).toEqual({ 'components.hello.text': 'There is no state "mesure". Name it in state, with its starting value' })
    expect(reading('/state/measure/deeper')).toEqual({ 'components.hello.text': 'A path from the top is "/state/<name>" or "/data/<source>"' })
    expect(reading('/data/orders')).toEqual({ 'components.hello.text': 'There is no data source "orders". Name it in data' })
    expect(reading('/viewer/name')).toEqual({ 'components.hello.text': 'A path from the top is "/state/<name>" or "/data/<source>"' })
    expect(reading('item')).toEqual({ 'components.hello.text': '"item" is read from a row, but this is not inside a table\'s row. A path from the top starts with "/"' })
    for (const wrong of ['', 7]) expect(reading(wrong)).toEqual({ 'components.hello.text': 'A path is text, such as "/state/measure" or, in a table\'s row, "item"' })
    expect(reading('/state/measure', { default: 'value' })).toEqual({ 'components.hello.text.default': 'A {"@path"} holds nothing else' })
  })

  test('a value the part writes back is a path', () => {
    const input = page([{ id: 'box', component: 'Input', label: 'Planned', value: 'planned_qty' }, { id: 'measure', component: 'Toggle', label: 'Show', options: [{ value: 'a', label: 'A' }], value: { '@path': 7 } }])
    expect(fields(input)).toEqual({
      'components.box.value': 'Expected a {"@path"}: the value the part reads and writes',
      'components.measure.value': 'Expected a {"@path"}: the value the part reads and writes',
    })
  })

  test('a function is one there is, with the arguments it takes', () => {
    const calling = (value: unknown) => fields(page([text('hello', { text: value })], { state: { measure: 'value', month: '2026-12' } }))
    expect(calling({ '@call': 'shout', args: {} })).toEqual({ 'components.hello.text': 'There is no function "shout". The functions are: eq, not, and, or, choose, formatNumber, formatCurrency, formatDate, formatString' })
    expect(calling({ '@call': 'eq', args: { a: 1 }, returns: 'boolean' })).toEqual({
      'components.hello.text.returns': 'A {"@call"} holds "args" and nothing else',
      'components.hello.text.args.b': 'eq needs "b"',
    })
    expect(calling({ '@call': 'eq', args: 'a' })).toEqual({
      'components.hello.text.args': 'args is an object of named values',
      'components.hello.text.args.a': 'eq needs "a"',
      'components.hello.text.args.b': 'eq needs "b"',
    })
    expect(calling({ '@call': 'not' })).toEqual({ 'components.hello.text.args.value': 'not needs "value"' })
    expect(calling({ '@call': 'not', args: { value: true, also: 1 } })).toEqual({ 'components.hello.text.args.also': 'not has no "also". It takes: value' })
    expect(calling({ '@call': 'and', args: { values: true } })).toEqual({ 'components.hello.text.args.values': 'Expected a list of values' })
    expect(calling({ '@call': 'or', args: { values: [true, { '@path': '/state/open' }, []] } })).toEqual({
      'components.hello.text.args.values.1': 'There is no state "open". Name it in state, with its starting value',
      'components.hello.text.args.values.2': 'Expected any value, a {"@path"} or a {"@call"}',
    })
    expect(calling({ '@call': 'choose', args: { key: { '@path': '/state/measure' }, from: 'value' } })).toEqual({ 'components.hello.text.args.from': 'Expected an object of named values' })
    expect(calling({ '@call': 'choose', args: { key: { '@path': '/state/measure' }, from: { value: 'By Value', quantity: { '@call': 'formatNumber', args: { value: 3, decimals: 0 } } }, otherwise: null } })).toEqual({})
    expect(calling({ '@call': 'formatString', args: { value: 'Plan for ${/state/month}, by ${/state/unit}' } })).toEqual({ 'components.hello.text.args.value': 'There is no state "unit". Name it in state, with its starting value' })
    expect(calling({ '@call': 'formatString', args: { value: { '@path': '/state/month' } } })).toEqual({})
    expect(calling({ '@call': 'formatString', args: { value: 7 } })).toEqual({ 'components.hello.text.args.value': 'Expected text, a {"@path"} or a {"@call"}' })
  })

  test('every part, function and action of the lists is in the catalog, with the worked example', () => {
    const catalog = pageCatalog()
    expect(Object.keys(catalog.parts)).toEqual(Object.keys(PAGE_PARTS))
    expect(Object.keys(catalog.functions)).toEqual(Object.keys(PAGE_FUNCTIONS))
    expect(Object.keys(catalog.actions)).toEqual(Object.keys(PAGE_ACTIONS))
    expect(catalog.parts.Text!.settings).toEqual({
      text: { holds: 'text, a {"@path"} or a {"@call"}', required: true, about: 'What it says.' },
      variant: { holds: 'one of: body, heading, caption, figure', required: false, about: 'How it reads. body when left out; figure is one large number.' },
    })
    expect(catalog.functions.choose).toEqual({ about: 'The one of "from" that "key" names; otherwise "otherwise".', use: '{"@call": "choose", "args": {"key": ..., "from": ..., "otherwise": ...}}', required: ['key', 'from'] })
    expect(catalog.actions.open_page).toMatchObject({ use: '{"event": {"name": "open_page", "context": {"page": ..., "state": ...}}}', required: ['page'] })
    expect(catalog).toMatchObject({ version: '1.0', rowCap: 500, example: PAGE_EXAMPLE })
    expect(checkPage(catalog.example).fields).toEqual({})
  })
})

describe('actions', () => {
  test('an action is one there is, with the context it takes', () => {
    const firing = (action: unknown) => fields(page([{ id: 'go', component: 'Button', label: 'Go', action }], { state: { open: '' } }))
    for (const wrong of ['save', {}, { event: 'save_row' }]) expect(firing(wrong)).toEqual({ 'components.go.action': 'Expected {"event": {"name", "context"}}' })
    expect(firing({ event: { name: 'delete_row' } })).toEqual({ 'components.go.action.event.name': 'There is no action "delete_row". The actions are: save_row, create_row, open_record, open_page, set_state' })
    expect(firing({ event: { name: 'save_row', context: { table: 'Reorder Line', force: true } } })).toEqual({
      'components.go.action.event.context.force': 'save_row has no "force". It takes: table, row, updated_at, values',
      'components.go.action.event.context.row': 'save_row needs "row"',
      'components.go.action.event.context.updated_at': 'save_row needs "updated_at"',
      'components.go.action.event.context.values': 'save_row needs "values"',
    })
    expect(firing({ event: { name: 'set_state' } })).toEqual({ 'components.go.action.event.context.values': 'set_state needs "values"' })
    expect(firing({ event: { name: 'open_record', context: { table: 7, row: 'L1' } } })).toEqual({ 'components.go.action.event.context.table': 'Expected text, written out' })
    expect(firing({ event: { name: 'open_page', context: { page: 'reorder-plan' } } })).toEqual({})
    expect(firing({ event: { name: 'open_page', context: { page: 'reorder-plan', state: 'open' } } })).toEqual({ 'components.go.action.event.context.state': 'Expected an object of named values' })
    expect(firing({ event: { name: 'set_state', context: { values: { open: 'Stationery', closed: true } } } })).toEqual({ 'components.go.action.event.context.values.closed': 'There is no state "closed". Name it in state, with its starting value' })
  })

  test('a save on a Table written out says which columns it writes; one whose Table is not text says none', () => {
    const saving = (context: Json) => checkPage(page([button({ name: 'create_row', context })]))
    expect(saving({ table: 'Reorder Line', values: { item: 'Notebook A5', planned_qty: 760 } }).writes).toEqual([{
      table: 'Reorder Line', at: 'components.go.action.event.context',
      columns: [{ column: 'item', at: 'components.go.action.event.context.values.item' }, { column: 'planned_qty', at: 'components.go.action.event.context.values.planned_qty' }],
    }])
    expect(saving({ table: '', values: {} })).toMatchObject({ writes: [], fields: { 'components.go.action.event.context.table': 'Expected text, written out' } })
    expect(checkPage(page([button({ name: 'open_page', context: { page: 'reorder-plan' } })])).writes).toEqual([])
  })
})

describe('a table', () => {
  const tabled = (more: Json, extra: PagePart[] = []) => fields(page([table(more), ...extra], { state: { open: '', measure: 'value' }, data: lines }))

  test('its rows are a source of the page', () => {
    for (const rows of [{ '@path': '/data/orders' }, { '@path': '/state/open' }, { '@path': '/data/lines/0' }])
      expect(tabled({ rows })).toMatchObject({ 'components.plan.rows': 'A table\'s rows are {"@path": "/data/<source>"}, naming a source in data' })
    expect(tabled({ rows: 'lines' })).toMatchObject({ 'components.plan.rows': 'Expected a {"@path"}: the value the part reads and writes' })
  })

  test('each column has an id of its own, a header, and a value or a cell', () => {
    expect(tabled({ columns: [] })).toEqual({ 'components.plan.columns': 'A table has at least one column' })
    expect(tabled({ columns: 'item' })).toEqual({ 'components.plan.columns': 'A table has at least one column' })
    expect(tabled({ columns: [
      'item', { id: 'my item', header: 'Item' }, { header: 'Item' },
      { id: 'item', value: { '@path': 'item' }, width: 120 },
      { id: 'item', header: 'Item' },
      { id: 'sold', header: 7, value: { '@path': 'sold_qty' }, align: 'right', format: 'money', total: 'average', visible: 'yes' },
      { id: 'link', header: 'Link', cell: 'ghost', total: 'sum' },
    ] })).toEqual({
      'components.plan.columns.0': 'A column is an object with an id: letters, digits and _, starting with a letter',
      'components.plan.columns.1': 'A column is an object with an id: letters, digits and _, starting with a letter',
      'components.plan.columns.2': 'A column is an object with an id: letters, digits and _, starting with a letter',
      'components.plan.columns.3.width': 'A column has no "width". It has: id, header, value, cell, align, format, total, visible',
      'components.plan.columns.3.header': 'A column needs a header',
      'components.plan.columns.4.id': 'Two columns have the id "item"',
      'components.plan.columns.4': 'A column needs a value (what a row shows) or a cell (a part drawn in each row)',
      'components.plan.columns.5.header': 'Expected text, a {"@path"} or a {"@call"}',
      'components.plan.columns.5.align': 'Expected one of: start, end',
      'components.plan.columns.5.format': 'Expected one of: text, number, currency, date',
      'components.plan.columns.5.total': 'Expected one of: sum',
      'components.plan.columns.5.visible': 'Expected true or false, a {"@path"} or a {"@call"}',
      'components.plan.columns.6.cell': 'There is no part with the id "ghost"',
      'components.plan.columns.6.total': 'A total adds up the column\'s value, so the column needs a value',
    })
  })

  test('a column\'s value and its cell read the table\'s own rows; its header and whether it shows read the page', () => {
    const cell = { ...text('name', { text: { '@path': 'item' } }), inner: true }
    const columns = [
      { id: 'item', header: { '@path': '/state/measure' }, cell: 'name', visible: { '@call': 'eq', args: { a: { '@path': '/state/measure' }, b: 'value' } } },
      { id: 'sold', header: 'Sold', value: { '@path': 'sold_qty' }, align: 'end', format: 'number', total: 'sum' },
    ]
    const check = checkPage(page([table({ columns, group_by: 'category', row_key: 'line_id', open: { '@path': '/state/open' } }), cell], { state: { open: '', measure: 'value' }, data: lines }))
    expect(check.fields).toEqual({})
    expect(check.tables[0]!.columns).toEqual([
      { column: 'category', at: 'components.plan.group_by' },
      { column: 'line_id', at: 'components.plan.row_key' },
      { column: 'sold_qty', at: 'components.plan.columns.1.value' },
      { column: 'item', at: 'components.name.text' },
    ])
  })

  test('a table whose rows are wrong does not also blame its group, and its columns are read where the table sits', () => {
    expect(tabled({ rows: { '@path': '/data/orders' }, group_by: 'category', row_key: 'line_id' })).toEqual({
      'components.plan.rows': 'A table\'s rows are {"@path": "/data/<source>"}, naming a source in data',
      'components.plan.columns.0.value': '"item" is read from a row, but this is not inside a table\'s row. A path from the top starts with "/"',
    })
  })

  test('a band names columns of the table that sit next to each other, each under one band', () => {
    const columns = ['item', 'sold', 'returned', 'suggested'].map((id) => ({ id, header: id, value: { '@path': id } }))
    const banded = (bands: unknown) => tabled({ columns, bands })
    expect(banded('Last Month')).toEqual({ 'components.plan.bands': 'Expected a list of {"label", "columns"}' })
    expect(banded([{ label: 'Last Month' }, { label: 7, columns: ['sold'] }, 'band', { label: 'Empty', columns: [] }])).toEqual({
      'components.plan.bands.0': 'A band is {"label", "columns"}: text, and the ids of the columns it spans',
      'components.plan.bands.1': 'A band is {"label", "columns"}: text, and the ids of the columns it spans',
      'components.plan.bands.2': 'A band is {"label", "columns"}: text, and the ids of the columns it spans',
      'components.plan.bands.3': 'A band is {"label", "columns"}: text, and the ids of the columns it spans',
    })
    expect(banded([{ label: 'Last Month', columns: ['sold', 'planned'] }])).toEqual({ 'components.plan.bands.0.columns': 'A band names columns of this table. Its columns: item, sold, returned, suggested' })
    expect(banded([{ label: 'Last Month', columns: ['sold', 'returned'] }, { label: 'Again', columns: ['returned', 'suggested'] }])).toEqual({ 'components.plan.bands.1.columns': 'A column sits under one band only' })
    expect(banded([{ label: 'Apart', columns: ['item', 'returned'] }])).toEqual({ 'components.plan.bands.0.columns': 'A band\'s columns sit next to each other, in the table\'s order' })
    expect(banded([{ label: 'Last Month', columns: ['sold', 'returned'] }, { label: 'Next Month', columns: ['suggested'] }])).toEqual({})
    expect(fields(page([table({ columns: 'item', bands: [{ label: 'Last Month', columns: ['sold'] }] })], { data: lines }))).toEqual({
      'components.plan.columns': 'A table has at least one column',
      'components.plan.bands.0.columns': 'A band names columns of this table. Its columns: ',
    })
    expect(fields(page([table({ columns: [7], bands: [{ label: 'Last Month', columns: ['sold'] }] })], { data: lines }))).toMatchObject({
      'components.plan.bands.0.columns': 'A band names columns of this table. Its columns: undefined',
    })
  })

  test('which group is open is page state, and only a grouped table has one', () => {
    expect(tabled({ group_by: 'category', open: { '@path': 'category' } })).toEqual({ 'components.plan.open': 'open is a {"@path": "/state/<key>"}' })
    expect(tabled({ open: { '@path': '/state/open' } })).toEqual({ 'components.plan.open': 'open goes with group_by: it holds which group is open' })
    expect(tabled({ group_by: '' })).toEqual({ 'components.plan.group_by': 'Expected text, written out' })
  })
})
