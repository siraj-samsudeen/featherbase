// #1196: a ticket's data quality rules. Each is one gap a filter describes,
// counted live as the viewer; the card shows them as a list, a table or tiles.
import { useEffect, useState, type ReactNode } from 'react'
import { read, type RecordData } from './api'
import { person } from './ticket-words'
import { Label } from './ticket-fields'

export type Filter = [string, string, unknown]
export type Rule = {
  row_id: string
  title: string
  table: string
  filters: Filter[]
  severity: string
  owner?: string | null
  how_to_fix?: string | null
  rows_when_raised: number
  rows_left: number | null
}
type Mutate = (name: string, payload: RecordData) => Promise<boolean>
export const LAYOUTS = ['List', 'Table', 'Tiles'] as const
export type Layout = (typeof LAYOUTS)[number]
const LAYOUT_KEY = 'tickets.rules.layout'
const SEVERITY_TONE: Record<string, string> = { High: 'tone-negative', Medium: 'tone-caution', Low: 'tone-neutral' }
const OPERATORS: [string, string][] = [['=', 'is'], ['!=', 'is not'], ['is blank', 'is blank'], ['is not blank', 'is not blank']]
const valueless = (op: string) => op.includes('blank')

const count = (n: number) => n.toLocaleString('en-IN')
const rows = (n: number) => `${count(n)} ${n === 1 ? 'row' : 'rows'}`
/** The platform list of the rule's Table, filtered to exactly its rows (the Admin list's address). */
export function rowsHref(rule: Pick<Rule, 'table' | 'filters'>) {
  const slug = rule.table.toLowerCase().replace(/[-_\s]+/g, ' ').trim().replace(/ /g, '-')
  return `/featherbase/admin/table/${encodeURIComponent(slug)}?filters=${encodeURIComponent(JSON.stringify(rule.filters))}`
}
export function describeFilters(filters: Filter[]) {
  return filters.map(([column, op, value]) => `${column} ${OPERATORS.find(([key]) => key === op)?.[1] ?? op}${valueless(op) ? '' : ` "${String(value)}"`}`).join(' and ')
}
export function savedLayout(): Layout {
  try {
    const value = localStorage.getItem(LAYOUT_KEY)
    return LAYOUTS.find((layout) => layout === value) ?? 'List'
  } catch { return 'List' }
}
function keep(layout: Layout) {
  try { localStorage.setItem(LAYOUT_KEY, layout) } catch { /* A browser that keeps nothing still switches. */ }
}

function Severity({ value }: { value: string }) {
  return <span className={`pill severity ${SEVERITY_TONE[value] ?? 'tone-neutral'}`}>{value}</span>
}
function Left({ rule }: { rule: Rule }) {
  if (rule.rows_left === null) return <span className="rule-left muted" title="You can't read this Table's rows, so they aren't counted for you">No access (raised with {count(rule.rows_when_raised)})</span>
  if (rule.rows_left === 0) return <span className="rule-left tone-text-positive">All clear (was {count(rule.rows_when_raised)})</span>
  return <span className="rule-left"><b>{count(rule.rows_left)}</b> of {count(rule.rows_when_raised)} left</span>
}
function Open({ rule }: { rule: Rule }) {
  return rule.rows_left ? <a className="rule-open" href={rowsHref(rule)} target="_blank" rel="noreferrer">Open these rows →</a> : null
}
function Remove({ rule, mutate, busy }: { rule: Rule; mutate: Mutate; busy: boolean }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button type="button" className="link-button" disabled={busy} onClick={() => setOpen(true)} aria-label={`Remove ${rule.title}`}>Remove</button>
  return (
    <form className="rule-remove" aria-label={`Remove ${rule.title}`} onSubmit={async (e) => {
      e.preventDefault()
      const reason = String(new FormData(e.currentTarget).get('reason') ?? '')
      if (await mutate('remove_rule', { rule: rule.row_id, reason })) setOpen(false)
    }}>
      <fieldset disabled={busy}>
        <Label title="Why remove it?"><input name="reason" required autoFocus /></Label>
        <div className="actions">
          <button type="button" onClick={() => setOpen(false)}>Cancel</button>
          <button className="primary">Remove rule</button>
        </div>
      </fieldset>
    </form>
  )
}

function ListLayout({ rules, edit }: { rules: Rule[]; edit?: (rule: Rule) => ReactNode }) {
  return (
    <ul className="rule-list">
      {rules.map((rule) => (
        <li key={rule.row_id} className={rule.rows_left === 0 ? 'clear' : ''}>
          <Severity value={rule.severity} />
          <div className="rule-what">
            <b>{rule.title}</b> <span className="muted">· {rule.table}</span>
            {rule.how_to_fix && <small>{rule.how_to_fix}</small>}
          </div>
          <Left rule={rule} />
          <span className="rule-links"><Open rule={rule} />{edit?.(rule)}</span>
        </li>
      ))}
    </ul>
  )
}
function TableLayout({ rules, edit }: { rules: Rule[]; edit?: (rule: Rule) => ReactNode }) {
  return (
    <table className="rule-table">
      <thead><tr><th>Severity</th><th>Rule</th><th>Table</th><th>Owner</th><th className="num">Left</th><th className="num">Raised</th><th /></tr></thead>
      <tbody>
        {rules.map((rule) => (
          <tr key={rule.row_id}>
            <td><Severity value={rule.severity} /></td>
            <td><b>{rule.title}</b><small>{describeFilters(rule.filters)}</small></td>
            <td>{rule.table}</td>
            <td>{rule.owner ? person(rule.owner) : '—'}</td>
            <td className="num">{rule.rows_left === null ? <span className="muted" title="You can't read this Table's rows, so they aren't counted for you">No access</span>
              : rule.rows_left === 0 ? <span className="tone-text-positive">All clear</span> : count(rule.rows_left)}</td>
            <td className="num">{count(rule.rows_when_raised)}</td>
            <td className="rule-links"><Open rule={rule} />{edit?.(rule)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
function TilesLayout({ rules, edit }: { rules: Rule[]; edit?: (rule: Rule) => ReactNode }) {
  return (
    <div className="rule-tiles">
      {rules.map((rule) => {
        const fixed = rule.rows_left === null ? 0 : rule.rows_when_raised - rule.rows_left
        const done = Math.max(0, Math.min(100, Math.round((fixed / rule.rows_when_raised) * 100)))
        return (
          <article key={rule.row_id} className="rule-tile" aria-label={rule.title}>
            <div className="rule-tile-top"><Severity value={rule.severity} /><span className="muted">{rule.table}</span></div>
            <h4>{rule.title}</h4>
            <Left rule={rule} />
            {rule.rows_left !== null && (
              <div className="rule-bar" role="progressbar" aria-label={`${rule.title} fixed`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${done}%` }} />
              </div>
            )}
            {rule.how_to_fix && <small>{rule.how_to_fix}</small>}
            <div className="rule-links"><Open rule={rule} />{edit?.(rule)}</div>
          </article>
        )
      })}
    </div>
  )
}

/** The rules on a ticket; `tables` is given to those who may add and remove them. */
export function RulesCard({ rules, tables, owners, defaultOwner, mutate, busy }: {
  rules: Rule[]
  tables?: string[]
  owners: { row_id: string; full_name: string }[]
  defaultOwner?: string
  mutate: Mutate
  busy: boolean
}) {
  const [layout, setLayout] = useState<Layout>(savedLayout)
  const [adding, setAdding] = useState(false)
  const editable = Array.isArray(tables)
  if (!rules.length && !editable) return null
  const left = rules.reduce((sum, rule) => sum + (rule.rows_left ?? 0), 0)
  const choose = (next: Layout) => { setLayout(next); keep(next) }
  const edit = editable ? (rule: Rule) => <Remove rule={rule} mutate={mutate} busy={busy} /> : undefined
  const Shown = layout === 'Table' ? TableLayout : layout === 'Tiles' ? TilesLayout : ListLayout
  return (
    <section className="card rules" aria-label="Rules">
      <div className="rules-heading">
        <h3>Rules · {rules.length}</h3>
        {rules.length > 0 && <span className={left ? 'rules-left' : 'rules-left tone-text-positive'}>{left ? `${rows(left)} still to fix` : 'All clear'}</span>}
        {rules.length > 0 && (
          <div className="segmented" role="group" aria-label="Rules layout">
            {LAYOUTS.map((name) => (
              <button key={name} type="button" aria-pressed={layout === name} className={layout === name ? 'active' : ''} onClick={() => choose(name)}>{name}</button>
            ))}
          </div>
        )}
      </div>
      {rules.length > 0 ? <Shown rules={rules} edit={edit} /> : <p className="fine">No rules yet. A rule counts the rows one filter describes, such as every buyer whose person is blank.</p>}
      {editable && (adding
        ? <AddRule tables={tables} owners={owners} defaultOwner={defaultOwner} mutate={mutate} busy={busy} close={() => setAdding(false)} />
        : <button type="button" className="secondary" disabled={busy} onClick={() => setAdding(true)}>Add a rule</button>)}
    </section>
  )
}

type Column = { column_name: string; label?: string; column_type?: string; hidden?: boolean | number }
async function columnsOf(table: string): Promise<Column[]> {
  const token = localStorage.getItem('fc_token')
  const response = await fetch(`/api/table/${encodeURIComponent(table)}:meta`, {
    credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) return []
  const meta = (await response.json()) as { columns?: Column[] }
  return (meta.columns ?? []).filter((c) => !c.hidden && c.column_type !== 'Sub-table')
}
type Preview = { state: 'idle' } | { state: 'counting' } | { state: 'counted'; count: number | null }

export function AddRule({ tables, owners, defaultOwner, mutate, busy, close }: {
  tables: string[]
  owners: { row_id: string; full_name: string }[]
  defaultOwner?: string
  mutate: Mutate
  busy: boolean
  close: () => void
}) {
  const [table, setTable] = useState('')
  const [columns, setColumns] = useState<Column[]>([])
  const [conditions, setConditions] = useState<Filter[]>([['', '=', '']])
  const [preview, setPreview] = useState<Preview>({ state: 'idle' })
  useEffect(() => {
    setColumns([])
    setConditions([['', '=', '']])
    if (table) void columnsOf(table).then(setColumns)
  }, [table])
  const complete = conditions.filter(([column, op, value]) => column && (valueless(op) || String(value ?? '') !== ''))
  const ready = Boolean(table) && complete.length === conditions.length
  const key = JSON.stringify([table, complete])
  useEffect(() => {
    if (!ready) return setPreview({ state: 'idle' })
    setPreview({ state: 'counting' })
    let current = true
    const timer = setTimeout(() => {
      void read<{ count: number | null }>('rule_preview', { table, filters: complete })
        .then((answer) => { if (current) setPreview({ state: 'counted', count: answer.count }) }, () => { if (current) setPreview({ state: 'idle' }) })
    }, 250)
    return () => { current = false; clearTimeout(timer) }
  }, [key])
  const change = (i: number, at: 0 | 1 | 2, value: string) =>
    setConditions((list) => list.map((c, k) => (k === i ? (Object.assign([...c], { [at]: value }) as Filter) : c)))
  const matches = preview.state === 'counted' ? preview.count : undefined
  return (
    <form id="action-add-rule" className="add-rule" onSubmit={async (e) => {
      e.preventDefault()
      const data = Object.fromEntries(new FormData(e.currentTarget))
      if (await mutate('add_rule', { title: data.title, table, filters: complete.map(([c, op, v]) => [c, op, valueless(op) ? null : v]),
        severity: data.severity, owner: data.owner || null, how_to_fix: data.how_to_fix || null })) close()
    }}>
      <fieldset disabled={busy}>
        <h4>Add a rule</h4>
        <Label title="Table">
          <select required value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">Choose a linked Table</option>
            {tables.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </Label>
        {table && (
          <div className="conditions" role="group" aria-label="Conditions">
            {conditions.map(([column, op, value], i) => (
              <div className="condition" key={i}>
                <select aria-label={`Column ${i + 1}`} value={column} onChange={(e) => change(i, 0, e.target.value)}>
                  <option value="">Column</option>
                  {columns.map((c) => <option key={c.column_name} value={c.column_name}>{c.label || c.column_name}</option>)}
                </select>
                <select aria-label={`Operator ${i + 1}`} value={op} onChange={(e) => change(i, 1, e.target.value)}>
                  {OPERATORS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                {valueless(op) ? <span /> : <input aria-label={`Value ${i + 1}`} value={String(value ?? '')} onChange={(e) => change(i, 2, e.target.value)} />}
                {conditions.length > 1 && <button type="button" className="link-button" onClick={() => setConditions((list) => list.filter((_, k) => k !== i))}>Remove condition</button>}
              </div>
            ))}
            {conditions.length < 10 && <button type="button" className="link-button" onClick={() => setConditions((list) => [...list, ['', '=', '']])}>Add a condition</button>}
          </div>
        )}
        <p className="rule-preview" aria-live="polite">
          {preview.state === 'counting' ? 'Counting…'
            : matches === null ? 'You may not read this Table, so it cannot be counted for you.'
            : matches === 0 ? 'Matches no rows, so there is nothing to fix.'
            : matches !== undefined ? `Matches ${rows(matches)}` : 'Choose a Table and conditions to see how many rows match.'}
        </p>
        <Label title="Title"><input name="title" required placeholder="Buyer is blank" /></Label>
        <div className="rule-row">
          <Label title="Severity">
            <select name="severity" defaultValue="Medium">{['High', 'Medium', 'Low'].map((s) => <option key={s}>{s}</option>)}</select>
          </Label>
          <Label title="Owner">
            <select name="owner" defaultValue={defaultOwner ?? ''}>
              <option value="">The ticket's assignee</option>
              {defaultOwner && !owners.some((p) => p.row_id === defaultOwner) && <option value={defaultOwner}>{person(defaultOwner)}</option>}
              {owners.map((p) => <option key={p.row_id} value={p.row_id}>{p.full_name}</option>)}
            </select>
          </Label>
        </div>
        <Label title="How to fix (optional)"><textarea name="how_to_fix" rows={2} /></Label>
        <div className="actions">
          <button type="button" onClick={close}>Cancel</button>
          <button className="primary" disabled={!matches}>Save rule</button>
        </div>
      </fieldset>
    </form>
  )
}
