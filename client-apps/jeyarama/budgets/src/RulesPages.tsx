// The close's rules: which line and store rule each account has, the P&L's lines, how shared
// costs are spread, and each store's area over time.
import { Button, DataList, FigureMatrix, FoldToggle, Notice, RecordLink, Skeleton, TABLE_CLASSES, TextInput, cellClasses, fmtDate, fmtExact, headCellClasses, labelClasses, type FigureRow } from '@featherbase/shop-floor'
import { Fragment, useState } from 'react'
import { runAction } from './api'
import { canEdit, useAccounts, useAreas, useLines, usePlants, useRefresh, useRuleSegments, useRuleStores, useRules, type Account, type Rule } from './data'
import { to, useRoute } from './route'
import { AccountLink, LineLink, Page, Pick, RegionLink, RuleLink, SegmentLink, StoreLink, num, storeName } from './ui'

const STORE_RULES = ['Plant', 'Cost Centre', 'Profit Centre']

export function AccountsPage() {
  const route = useRoute()
  const refresh = useRefresh()
  const [accounts, lines] = [useAccounts(), useLines()]
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['none']))
  const [change, setChange] = useState({ pl_line: '', store_rule: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = (key: string) => route.params.get(key) ?? ''
  const working = (lines.data ?? []).filter(line => line.level === 'Working')
  const lineName = (id: string | null) => (id ? lines.data?.find(l => l.row_id === id)?.line_name ?? id : 'Not Classified')
  const rows = (accounts.data ?? []).filter(a => (!pick('statement') || a.statement === pick('statement')) && (!pick('rule') || a.store_rule === pick('rule'))
    && (!pick('line') || (pick('line') === 'none' ? !a.pl_line && a.statement === 'P&L' : a.pl_line === pick('line'))))
  const groups = new Map<string, Account[]>()
  // A balance sheet account needs no P&L line, so it is not waiting to be classified.
  for (const account of rows) { const key = account.pl_line ?? (account.statement === 'P&L' ? 'none' : 'balance'); groups.set(key, [...(groups.get(key) ?? []), account]) }
  const groupName = (key: string) => (key === 'balance' ? 'Balance Sheet' : lineName(key === 'none' ? null : key))
  const rank = (key: string) => (key === 'none' ? 0 : key === 'balance' ? 2 : 1)
  const ordered = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || groupName(a).localeCompare(groupName(b)))
  const flip = (set: ReadonlySet<string>, ids: string[], on?: boolean) => { const next = new Set(set); for (const id of ids) (on ?? !next.has(id)) ? next.add(id) : next.delete(id); return next }
  const asked = Object.fromEntries(Object.entries(change).filter(([, value]) => value))
  const editor = canEdit()
  const any = { value: '', label: 'Any' }

  async function apply() {
    setBusy(true); setError('')
    try { await runAction('set_accounts', { accounts: [...chosen], change: asked }); setChosen(new Set()); setChange({ pl_line: '', store_rule: '' }); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save') } finally { setBusy(false) }
  }

  return <Page title="Accounts" count={`${rows.length} of ${accounts.data?.length ?? 0}`} status="Each SAP account, the P&L line it belongs to, and the SAP field that gives its store.">
    {(accounts.error || error) && <Notice tone="negative">{accounts.error?.message ?? error}</Notice>}
    <div className="flex flex-wrap items-end gap-3">
      <Pick label="Statement" value={pick('statement')} onChange={value => route.set({ statement: value || null })} options={[any, { value: 'P&L', label: 'P&L' }, { value: 'Balance Sheet', label: 'Balance Sheet' }]} />
      <Pick label="Store Rule" value={pick('rule')} onChange={value => route.set({ rule: value || null })} options={[any, ...STORE_RULES.map(r => ({ value: r, label: r }))]} />
      <Pick label="P&L Line" value={pick('line')} onChange={value => route.set({ line: value || null })} options={[any, { value: 'none', label: 'Not Classified' }, ...working.map(l => ({ value: l.row_id, label: l.line_name }))]} />
    </div>
    {editor && chosen.size > 0 && <div role="group" aria-label="Change the selected accounts" className="flex flex-wrap items-end gap-3 rounded-control bg-subtle p-3">
      <span className="self-center text-sm font-medium text-ink">{chosen.size} selected</span>
      <Pick label="P&L Line" value={change.pl_line} onChange={value => setChange({ ...change, pl_line: value })} options={[{ value: '', label: 'Leave As It Is' }, ...working.map(l => ({ value: l.row_id, label: l.line_name }))]} />
      <Pick label="Store Rule" value={change.store_rule} onChange={value => setChange({ ...change, store_rule: value })} options={[{ value: '', label: 'Leave As It Is' }, ...STORE_RULES.map(r => ({ value: r, label: r }))]} />
      <Button variant="primary" loading={busy} disabled={!Object.keys(asked).length} onClick={apply}>Change {chosen.size} {chosen.size === 1 ? 'Account' : 'Accounts'}</Button>
      <Button onClick={() => setChosen(new Set())}>Clear The Selection</Button>
    </div>}
    {accounts.isLoading ? <Skeleton label="Loading accounts" lines={8} /> : !rows.length ? <p className="text-sm text-ink-subtle">No accounts match.</p> : <div className="max-w-full overflow-auto">
      <table aria-label="Accounts by P&L line" className={TABLE_CLASSES}>
        <thead><tr>
          <th scope="col" className={headCellClasses({ first: true })}>P&L Line</th>
          <th scope="col" className={headCellClasses()}>Account</th>
          <th scope="col" className={headCellClasses()}>Statement</th>
          <th scope="col" className={headCellClasses()}>Store Rule</th>
          <th scope="col" className={headCellClasses({ last: true })}>Note</th>
        </tr></thead>
        <tbody>{ordered.map(([key, group]) => {
          const isOpen = open.has(key)
          const all = group.every(a => chosen.has(a.row_id))
          return <Fragment key={key}>
            <tr className="group">
              <th scope="row" colSpan={5} className={cellClasses({ density: 'compact', first: true, last: true, className: 'text-left font-medium' })}>
                <span className="inline-flex items-center gap-2">
                  {editor && <input type="checkbox" aria-label={`Select all of ${groupName(key)}`} checked={all} onChange={() => setChosen(flip(chosen, group.map(a => a.row_id), !all))} />}
                  <FoldToggle open={isOpen} onToggle={() => setOpen(flip(open, [key]))} label={groupName(key)} />{key === 'none' || key === 'balance' ? <span>{groupName(key)}</span> : <LineLink id={key} />}
                  <span className="font-normal whitespace-nowrap text-ink-subtle">{group.length} {group.length === 1 ? 'account' : 'accounts'}</span>
                </span>
              </th>
            </tr>
            {isOpen && group.map(account => <tr key={account.row_id} className="group">
              <td className={cellClasses({ density: 'compact', first: true, className: 'pl-9' })}>{editor && <input type="checkbox" aria-label={`Select ${account.account_name}`} checked={chosen.has(account.row_id)} onChange={() => setChosen(flip(chosen, [account.row_id]))} />}</td>
              <td className={cellClasses({ density: 'compact', className: 'whitespace-nowrap' })}><AccountLink id={account.row_id} /></td>
              <td className={cellClasses({ density: 'compact' })}>{account.statement}</td>
              <td className={cellClasses({ density: 'compact', className: 'whitespace-nowrap' })}>{account.store_rule ?? ''}{account.falls_back_to_cost_centre ? ', else Cost Centre' : ''}</td>
              <td className={cellClasses({ density: 'compact', last: true, className: 'text-ink-muted' })}>{account.note ?? ''}</td>
            </tr>)}
          </Fragment>
        })}</tbody>
      </table>
    </div>}
  </Page>
}

export function LinesPage() {
  const [lines, accounts] = [useLines(), useAccounts()]
  const count = (line: string) => (accounts.data ?? []).filter(a => a.pl_line === line).length
  const published = (lines.data ?? []).filter(line => line.level === 'Published')
  const detail = (kind: string, sign: string, rule: string | null) => (kind === 'Subtotal' ? `Subtotal, ${(rule ?? '').toLowerCase()}` : kind === 'Memo' ? 'Memo, not added' : `${kind} ${sign.toLowerCase()}`)
  const rows: FigureRow[] = published.map((line) => {
    const working = (lines.data ?? []).filter(w => w.rolls_into === line.row_id)
    return { id: line.row_id, label: line.line_name, header: <RecordLink table="budgets.pl_line" rowId={line.row_id} name={line.line_name} detail={detail(line.line_kind, line.sign, line.subtotal_rule)} />,
      strong: line.line_kind === 'Subtotal', quiet: line.line_kind === 'Memo', values: { accounts: working.reduce((sum, w) => sum + count(w.row_id), 0) || null },
      ...(working.length ? { children: working.map(w => ({ id: w.row_id, label: w.line_name, header: <RecordLink table="budgets.pl_line" rowId={w.row_id} name={w.line_name} detail={w.sign === line.sign ? undefined : `taken away (${w.sign.toLowerCase()})`} />, values: { accounts: count(w.row_id) || null } })) } : {}) }
  })
  return <Page title="P&L Lines" count={`${published.length} published, ${(lines.data?.length ?? 0) - published.length} working`} status="The P&L in order. A published line unfolds to the working lines that add up to it; a subtotal is worked out from the lines above it.">
    {lines.error && <Notice tone="negative">{lines.error.message}</Notice>}
    {lines.isLoading ? <Skeleton label="Loading lines" lines={8} /> : <FigureMatrix label="P&L lines in order" rowHeading="Line" columns={[{ id: 'accounts', label: 'Accounts' }]} rows={rows}
      format={value => (value == null ? '' : String(value))} cellHref={(row) => (row.values.accounts ? to('accounts', '', { line: row.children ? null : row.id }) : undefined)} empty="No P&L lines yet." />}
  </Page>
}

/** A rule said as one sentence, the way the controller would say it. */
function RuleSentence({ rule }: { rule: Rule }) {
  const segments = (useRuleSegments().data ?? []).filter(s => s.allocation_rule === rule.row_id)
  const region = rule.operating_region ? <> across <RegionLink id={rule.operating_region} /> stores</> : ' across every store'
  if (rule.rule_kind === 'Standing Charge')
    return <>{fmtExact(num(rule.rate_per_sqft))} per sq ft a month is charged to the stores this rule names, on <LineLink id={rule.target_line} />.</>
  const pool = rule.source_plant ? <>The cost of <StoreLink id={rule.source_plant} /></> : <><LineLink id={rule.source_line} /></>
  const basis = rule.basis === 'Net Sales Of Named Segments'
    ? <>net sales of {segments.length ? segments.map((s, index) => <span key={s.row_id}>{index > 0 && (index === segments.length - 1 ? ' and ' : ', ')}<SegmentLink id={s.business_line_segment} /></span>) : 'the segments it names'}</>
    : rule.basis.toLowerCase()
  return <>{pool} is spread{region} by {basis}, on <LineLink id={rule.target_line} />.</>
}

export function RulesPage() {
  const rules = useRules()
  const today = new Date().toISOString().slice(0, 10)
  return <Page title="Allocation Rules" count={`${rules.data?.length ?? 0} rules`} status="How shared costs are spread across stores, and the standing charges that have no book entry, in the order they run.">
    {rules.error && <Notice tone="negative">{rules.error.message}</Notice>}
    <DataList caption="Allocation rules in run order" rows={rules.data ?? []} rowKey={row => row.row_id} state={rules.isLoading ? 'loading' : 'ready'}
      empty={{ title: 'No Rules Yet', body: 'A Budget Editor adds allocation rules in Featherbase.' }} columns={[
        { key: 'order', header: 'Order', align: 'end', cell: row => row.run_order },
        { key: 'rule', header: 'Rule', cell: row => <RuleLink id={row.row_id} />, phone: 'title' },
        { key: 'says', header: 'What It Does', cell: row => <RuleSentence rule={row} /> },
        { key: 'from', header: 'In Force', cell: row => `${fmtDate(row.starts_on.slice(0, 10))}${row.ends_on ? ` to ${fmtDate(row.ends_on.slice(0, 10))}` : ' onwards'}${row.ends_on && row.ends_on.slice(0, 10) < today ? ' (ended)' : ''}` },
      ]} />
  </Page>
}

export function RulePage({ id }: { id: string }) {
  const [rules, stores, segments] = [useRules(), useRuleStores(), useRuleSegments()]
  const rule = rules.data?.find(r => r.row_id === id)
  if (rules.isLoading) return <Page title="Allocation Rule"><Skeleton label="Loading the rule" /></Page>
  if (!rule) return <Page title="Allocation Rule"><Notice tone="negative">There is no rule {id}, or you may not see it.</Notice></Page>
  const mine = (stores.data ?? []).filter(s => s.allocation_rule === id)
  const named = (segments.data ?? []).filter(s => s.allocation_rule === id)
  return <Page title={rule.rule_name} count={`${rule.rule_kind}, runs ${rule.run_order}`} breadcrumb={<a href={to('rules')} className="hover:underline">Allocation Rules</a>}
    status={<><RuleSentence rule={rule} /> In force from {fmtDate(rule.starts_on.slice(0, 10))}{rule.ends_on ? ` to ${fmtDate(rule.ends_on.slice(0, 10))}` : ''}.{' '}
      <RecordLink table="budgets.allocation_rule" rowId={id} name="Details And History" href={to('record', `allocation_rule/${id}`)} /></>}>
    {rule.note && <p className="text-sm text-ink-muted">{rule.note}</p>}
    {named.length > 0 && <section aria-label="Segments Counted" className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold text-ink">Segments Counted</h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{named.map(s => <li key={s.row_id}><SegmentLink id={s.business_line_segment} /></li>)}</ul>
    </section>}
    <section aria-label="Stores Treated Differently" className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold text-ink">Stores Treated Differently</h2>
      <DataList caption="Stores this rule treats differently" rows={mine} rowKey={row => row.row_id} state={stores.isLoading ? 'loading' : 'ready'}
        empty={{ title: 'No Exceptions', body: 'Every store in the region is treated the same by this rule.' }} columns={[
          { key: 'store', header: 'Store', cell: row => <StoreLink id={row.plant} />, phone: 'title' },
          { key: 'treatment', header: 'Treatment', cell: row => row.treatment },
          { key: 'share', header: 'Share %', align: 'end', cell: row => row.share_percent ?? '' },
          { key: 'amount', header: 'Amount', align: 'end', cell: row => (row.amount == null ? '' : fmtExact(num(row.amount))) },
          { key: 'area', header: 'Area Charged (Sq Ft)', align: 'end', cell: row => (row.area_sqft == null ? '' : Number(row.area_sqft).toLocaleString('en-IN')) },
        ]} />
    </section>
  </Page>
}

export function AreasPage() {
  const refresh = useRefresh()
  const [areas, plants] = [useAreas(), usePlants()]
  const [adding, setAdding] = useState<{ plant: string; starts_on: string; area_sqft: string; note: string } | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const whole = (areas.data ?? []).filter(area => !area.business_line_segment)
  const stores = [...new Set(whole.map(area => area.plant))].sort()
  const editor = canEdit()

  async function add() {
    setBusy(true); setError('')
    try { await runAction('add_store_area', { plant: adding!.plant, starts_on: adding!.starts_on, area_sqft: Number(adding!.area_sqft), note: adding!.note || null }); setAdding(null); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save') } finally { setBusy(false) }
  }
  return <Page title="Store Areas" count={`${stores.length} stores`} status="Each store's trading area, from the day it applied. Area drives head office cost, notional rent and every per-sq-ft figure."
    actions={editor && <Button variant="primary" onClick={() => setAdding(adding ? null : { plant: plants.data?.find(p => p.plant_type === 'Store')?.row_id ?? '', starts_on: '', area_sqft: '', note: '' })}>Add An Area</Button>}>
    {(areas.error || error) && <Notice tone="negative">{areas.error?.message ?? error}</Notice>}
    {adding && <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void add() }}>
      <Pick label="Store" value={adding.plant} onChange={value => setAdding({ ...adding, plant: value })} options={(plants.data ?? []).map(plant => ({ value: plant.row_id, label: `${storeName(plants.data, plant.row_id)} · ${plant.row_id}` }))} />
      <label><span className={labelClasses('mb-1')}>From</span><TextInput type="date" required value={adding.starts_on} onChange={event => setAdding({ ...adding, starts_on: event.target.value })} /></label>
      <label><span className={labelClasses('mb-1')}>Area (Sq Ft)</span><TextInput required inputMode="decimal" value={adding.area_sqft} onChange={event => setAdding({ ...adding, area_sqft: event.target.value })} /></label>
      <label className="min-w-64 flex-1"><span className={labelClasses('mb-1')}>Where The Figure Came From</span><TextInput value={adding.note} onChange={event => setAdding({ ...adding, note: event.target.value })} /></label>
      <Button type="submit" variant="primary" loading={busy}>Save The Area</Button>
      <p className="basis-full text-sm text-ink-muted">The store's area before this one ends the day before.</p>
    </form>}
    {areas.isLoading ? <Skeleton label="Loading areas" lines={6} /> : !stores.length ? <p className="text-sm text-ink-subtle">No store has an area yet.</p> : <div className="max-w-full overflow-auto">
      <table aria-label="Store areas" className={TABLE_CLASSES}>
        <thead><tr>
          <th scope="col" className={headCellClasses({ first: true })}>Store</th>
          <th scope="col" className={headCellClasses({ className: 'text-right' })}>Area (Sq Ft)</th>
          <th scope="col" className={headCellClasses()}>From</th>
          <th scope="col" className={headCellClasses()}>To</th>
          <th scope="col" className={headCellClasses({ last: true })}>Where The Figure Came From</th>
        </tr></thead>
        <tbody>{stores.map((plant) => {
          const history = whole.filter(area => area.plant === plant).sort((a, b) => b.starts_on.localeCompare(a.starts_on))
          const [current, ...earlier] = history
          const isOpen = open.has(plant)
          const row = (area: typeof current, first: boolean) => <tr key={area.row_id} className="group">
            <th scope="row" className={cellClasses({ density: 'compact', first: true, className: first ? 'text-left font-normal whitespace-nowrap' : 'pl-9 text-left font-normal text-ink-subtle' })}>
              {first ? <span className="inline-flex items-center gap-2"><StoreLink id={plant} />{earlier.length > 0 && <button type="button" aria-expanded={isOpen} onClick={() => { const next = new Set(open); if (!next.delete(plant)) next.add(plant); setOpen(next) }}
                className="rounded-control text-[13px] text-action hover:underline focus-visible:outline-2 focus-visible:outline-focus">{earlier.length} earlier</button>}</span>
                : <RecordLink table="budgets.store_area" rowId={area.row_id} name="Earlier area" />}
            </th>
            <td className={cellClasses({ density: 'compact', className: 'text-right tabular-nums' })}>{Number(area.area_sqft).toLocaleString('en-IN')}</td>
            <td className={cellClasses({ density: 'compact', className: 'whitespace-nowrap' })}>{fmtDate(area.starts_on.slice(0, 10))}</td>
            <td className={cellClasses({ density: 'compact', className: 'whitespace-nowrap' })}>{area.ends_on ? fmtDate(area.ends_on.slice(0, 10)) : ''}</td>
            <td className={cellClasses({ density: 'compact', last: true, className: 'text-ink-muted' })}>{area.note ?? ''}</td>
          </tr>
          return <Fragment key={plant}>{row(current, true)}{isOpen && earlier.map(area => row(area, false))}</Fragment>
        })}</tbody>
      </table>
    </div>}
  </Page>
}
