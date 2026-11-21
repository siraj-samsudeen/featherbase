// The monthly close: the list of closes, one close with its manual lines, and every
// adjustment across months. A Budget Editor pastes lines, changes several together, matches
// one to its SAP posting, publishes and starts the next version.
import { Button, DataList, FoldToggle, Notice, PasteRows, RecordLink, Skeleton, TABLE_CLASSES, TextInput, cellClasses, fmtExact, fmtInstantIST, headCellClasses, labelClasses } from '@featherbase/shop-floor'
import { Fragment, useState } from 'react'
import { runAction } from './api'
import { canEdit, useAccounts, useAdjustments, useCloses, usePeople, usePlants, useRefresh, type Adjustment, type Close } from './data'
import { ADJUSTMENT_TYPES, amountOf, checkAdjustments, type AdjustmentValue, type CheckedRow } from './pasteRules'
import { to, useRoute } from './route'
import { AccountLink, CloseLink, CompanyLink, Page, PersonName, Pick, StatePill, StoreLink, closeName, dayInIndia, num, storeName } from './ui'
import { fmtMonth } from './words'

const STATES = ['Open', 'Posted In SAP', 'Released', 'Carried Forward']
const monthKey = (day: string) => `${day.slice(0, 7)}-01`

/** The lines a close carries: its own and those of the month's earlier versions, until one withdraws them. */
function linesOf(close: Close, closes: Close[], adjustments: Adjustment[]) {
  const versionOf = new Map(closes.filter(c => c.legal_company === close.legal_company && monthKey(c.close_month) === monthKey(close.close_month)).map(c => [c.row_id, c.version_no]))
  return adjustments.filter(a => (versionOf.get(a.monthly_close) ?? Infinity) <= close.version_no && !(a.withdrawn_in && (versionOf.get(a.withdrawn_in) ?? Infinity) <= close.version_no))
}

export function ClosesPage() {
  const closes = useCloses()
  const adjustments = useAdjustments()
  const open = (close: Close) => linesOf(close, closes.data ?? [], adjustments.data ?? []).filter(a => a.adjustment_state === 'Open').length
  return <Page title="Monthly Close" count={`${closes.data?.length ?? 0} closes`} status="One row for each publication of a company's month. The download time is the cut: a later SAP posting is not part of that close.">
    {closes.error && <Notice tone="negative">{closes.error.message}</Notice>}
    <DataList caption="Monthly closes" rows={[...(closes.data ?? [])].sort((a, b) => b.close_month.localeCompare(a.close_month) || b.version_no - a.version_no)} rowKey={row => row.row_id}
      state={closes.isLoading ? 'loading' : 'ready'} empty={{ title: 'No Close Yet', body: 'A Budget Editor adds a month’s first close in Featherbase; later versions are made from its page here.' }} columns={[
        { key: 'close', header: 'Close', cell: row => <CloseLink id={row.row_id} />, phone: 'title' },
        { key: 'company', header: 'Company', cell: row => <CompanyLink id={row.legal_company} /> },
        { key: 'downloaded', header: 'Trial Balance Downloaded', cell: row => fmtInstantIST(row.downloaded_at) },
        { key: 'state', header: 'State', cell: row => <StatePill state={row.close_state} />, phone: 'status' },
        { key: 'published', header: 'Published', cell: row => row.published_at ? <>{dayInIndia(row.published_at)} by <PersonName id={row.published_by} /></> : '' },
        { key: 'open', header: 'Adjustments Open', align: 'end', cell: row => open(row) || '' },
      ]} />
  </Page>
}

type GroupBy = 'reason' | 'adjustment_type' | 'plant' | 'adjustment_state' | 'month'

/** Adjustments as a grouped table: one row per group with its count and total, unfolding to its lines. */
function AdjustmentTable({ rows, groupBy, editable, label, typeFixed = false }: { rows: Adjustment[]; groupBy: GroupBy; editable: boolean; label: string
  /** A published close's lines keep their type: only state and owner change together. */
  typeFixed?: boolean }) {
  const refresh = useRefresh()
  const [plants, people, closes] = [usePlants(), usePeople(), useCloses()]
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [matching, setMatching] = useState<{ id: string; document: string; amount: string } | null>(null)
  const [change, setChange] = useState({ adjustment_state: '', owner: '', adjustment_type: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const monthOf = (row: Adjustment) => { const close = closes.data?.find(c => c.row_id === row.monthly_close); return close ? fmtMonth(close.close_month) : '' }
  const keyOf = (row: Adjustment) => groupBy === 'plant' ? `${storeName(plants.data, row.plant)} · ${row.plant}` : groupBy === 'month' ? monthOf(row) : String(row[groupBy] ?? '')
  const groups = new Map<string, Adjustment[]>()
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row])
  const flip = (set: ReadonlySet<string>, ids: string[], on?: boolean) => { const next = new Set(set); for (const id of ids) (on ?? !next.has(id)) ? next.add(id) : next.delete(id); return next }

  async function run(work: () => Promise<unknown>, done: () => void) {
    setBusy(true); setError('')
    try { await work(); done(); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Could not save') } finally { setBusy(false) }
  }
  const asked = Object.fromEntries(Object.entries(change).filter(([, value]) => value))
  if (!rows.length) return <p className="text-sm text-ink-subtle">No adjustments here.</p>
  // The P&L line is the account's, and is on the adjustment's own page: leaving it out keeps an open group inside the page.
  const columns = ['Store', 'Account', 'Type', 'Amount', 'State', 'Remaining', 'Owner', ...(editable ? [''] : [])]

  return <div className="flex min-w-0 flex-col gap-3">
    {error && <Notice tone="negative">{error}</Notice>}
    {editable && chosen.size > 0 && <div role="group" aria-label="Change the selected adjustments" className="flex flex-wrap items-end gap-3 rounded-control bg-subtle p-3">
      <span className="self-center text-sm font-medium text-ink">{chosen.size} selected</span>
      <Pick label="State" value={change.adjustment_state} onChange={value => setChange({ ...change, adjustment_state: value })} options={[{ value: '', label: 'Leave As It Is' }, ...STATES.map(s => ({ value: s, label: s }))]} />
      <Pick label="Owner" value={change.owner} onChange={value => setChange({ ...change, owner: value })} options={[{ value: '', label: 'Leave As It Is' }, ...(people.data ?? []).map(p => ({ value: p.row_id, label: p.full_name ?? p.row_id }))]} />
      {!typeFixed && <Pick label="Type" value={change.adjustment_type} onChange={value => setChange({ ...change, adjustment_type: value })} options={[{ value: '', label: 'Leave As It Is' }, ...ADJUSTMENT_TYPES.map(t => ({ value: t, label: t }))]} />}
      <Button variant="primary" loading={busy} disabled={!Object.keys(asked).length} onClick={() => run(() => runAction('set_adjustments', { adjustments: [...chosen], change: asked }), () => { setChosen(new Set()); setChange({ adjustment_state: '', owner: '', adjustment_type: '' }) })}>Change {chosen.size} {chosen.size === 1 ? 'Adjustment' : 'Adjustments'}</Button>
      <Button onClick={() => setChosen(new Set())}>Clear The Selection</Button>
    </div>}
    <div className="max-w-full overflow-auto">
      {/* A fixed layout: the table is exactly as wide as its space, text wraps inside its column, and amounts stay on one line. */}
      <table aria-label={label} className={`${TABLE_CLASSES} table-fixed`}>
        <colgroup>{(editable ? [15, 11, 13, 11, 12, 12, 12, 8, 6] : [18, 12, 14, 12, 12, 11, 12, 9]).map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
        <thead><tr>
          <th scope="col" className={headCellClasses({ first: true })}>Adjustment</th>
          {columns.map((column, index) => <th key={index} scope="col" className={headCellClasses({ last: index === columns.length - 1, className: `px-2! ${['Amount', 'Remaining'].includes(column) ? 'text-right' : ''}` })}>{column}</th>)}
        </tr></thead>
        <tbody>
          {[...groups.entries()].map(([group, lines]) => {
            const isOpen = open.has(group)
            const all = lines.every(line => chosen.has(line.row_id))
            const types = [...new Set(lines.map(line => line.adjustment_type))]
            return <Fragment key={group}>
              <tr className="group">
                <th scope="row" colSpan={3} className={cellClasses({ density: 'compact', first: true, className: 'h-auto! py-1.5 text-left font-medium' })}>
                  {/* The checkbox stays beside the first line of a reason that wraps; the count follows the words. */}
                  <span className="flex items-start gap-2">
                    {editable && <input type="checkbox" className="mt-1 shrink-0" aria-label={`Select all of ${group}`} checked={all} onChange={() => setChosen(flip(chosen, lines.map(l => l.row_id), !all))} />}
                    <span className="min-w-0 [&>button]:mr-2 [&>button]:items-start [&>button>svg]:mt-1">
                      <FoldToggle open={isOpen} onToggle={() => setOpen(flip(open, [group]))} count={`${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`}>{group || 'No Reason Given'}</FoldToggle>
                    </span>
                  </span>
                </th>
                <td className={cellClasses({ density: 'compact', className: 'px-2! text-ink-subtle' })}>{groupBy === 'adjustment_type' ? '' : types.join(', ')}</td>
                <td className={cellClasses({ density: 'compact', className: 'px-2! text-right font-semibold tabular-nums whitespace-nowrap' })}>{fmtExact(lines.reduce((sum, line) => sum + num(line.amount), 0))}</td>
                <td className={cellClasses({ density: 'compact' })} />
                <td className={cellClasses({ density: 'compact', className: 'px-2! text-right font-semibold tabular-nums whitespace-nowrap' })}>{fmtExact(lines.reduce((sum, line) => sum + num(line.remaining_amount), 0))}</td>
                <td className={cellClasses({ density: 'compact', last: !editable })} />{editable && <td className={cellClasses({ density: 'compact', last: true })} />}
              </tr>
              {isOpen && lines.map(line => <Fragment key={line.row_id}>
                <tr className="group">
                  <td className={cellClasses({ density: 'compact', first: true, className: 'h-auto! py-1.5 pl-6' })}>
                    <span className="inline-flex items-center gap-2">
                      {editable && <input type="checkbox" aria-label={`Select ${line.row_id}`} checked={chosen.has(line.row_id)} onChange={() => setChosen(flip(chosen, [line.row_id]))} />}
                      <RecordLink table="budgets.monthly_close_adjustment" rowId={line.row_id} name={line.row_id} detail={groupBy === 'reason' ? undefined : line.reason} />
                    </span>
                  </td>
                  <td className={cellClasses({ density: 'compact', className: 'h-auto! px-2! py-1.5' })}><StoreLink id={line.plant} /></td>
                  <td className={cellClasses({ density: 'compact', className: 'h-auto! px-2! py-1.5' })}><AccountLink id={line.gl_account} /></td>
                  <td className={cellClasses({ density: 'compact', className: 'px-2!' })}>{line.adjustment_type}</td>
                  <td className={cellClasses({ density: 'compact', className: 'px-2! text-right tabular-nums whitespace-nowrap' })}>{fmtExact(num(line.amount))}</td>
                  <td className={cellClasses({ density: 'compact', className: 'px-2!' })}><StatePill state={line.adjustment_state} /></td>
                  <td className={cellClasses({ density: 'compact', className: 'px-2! text-right tabular-nums whitespace-nowrap' })}>{fmtExact(num(line.remaining_amount))}</td>
                  <td className={cellClasses({ density: 'compact', last: !editable, className: 'h-auto! px-2! py-1.5' })}><PersonName id={line.owner} /></td>
                  {editable && <td className={cellClasses({ density: 'compact', last: true, className: 'px-2!' })}>{num(line.remaining_amount) !== 0 && <button type="button" aria-label={`Match ${line.row_id} to SAP`} onClick={() => setMatching({ id: line.row_id, document: '', amount: String(num(line.remaining_amount)) })}
                    className="rounded-control text-[13px] whitespace-nowrap text-action hover:underline focus-visible:outline-2 focus-visible:outline-focus">Match</button>}</td>}
                </tr>
                {matching?.id === line.row_id && <tr><td colSpan={columns.length + 1} className="px-9 py-3">
                  <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void run(() => runAction('match_adjustment', { adjustment: line.row_id, document: matching.document, amount: amountOf(matching.amount) }), () => setMatching(null)) }}>
                    <label><span className={labelClasses('mb-1')}>SAP Document</span><TextInput required autoFocus value={matching.document} onChange={event => setMatching({ ...matching, document: event.target.value })} /></label>
                    <label><span className={labelClasses('mb-1')}>Amount It Settles (₹)</span><TextInput required inputMode="decimal" value={matching.amount} onChange={event => setMatching({ ...matching, amount: event.target.value })} /></label>
                    <Button type="submit" variant="primary" loading={busy}>Record The Match</Button>
                    <Button onClick={() => setMatching(null)}>Not Now</Button>
                    {line.matched_sap_document && <p className="basis-full text-sm text-ink-muted">Already matched to {line.matched_sap_document} for {fmtExact(num(line.matched_amount))}.</p>}
                  </form>
                </td></tr>}
              </Fragment>)}
            </Fragment>
          })}
        </tbody>
      </table>
    </div>
  </div>
}

export function ClosePage({ id }: { id: string }) {
  const refresh = useRefresh()
  const [closes, adjustments, accounts, plants] = [useCloses(), useAdjustments(), useAccounts(), usePlants()]
  const [panel, setPanel] = useState<'' | 'paste' | 'publish' | 'next'>('')
  const [downloaded, setDownloaded] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const close = closes.data?.find(c => c.row_id === id)
  if (closes.isLoading || adjustments.isLoading) return <Page title="Monthly Close"><Skeleton label="Loading the close" lines={8} /></Page>
  if (!close) return <Page title="Monthly Close"><Notice tone="negative">There is no close {id}, or you may not see it.</Notice></Page>

  const siblings = (closes.data ?? []).filter(c => c.legal_company === close.legal_company && monthKey(c.close_month) === monthKey(close.close_month))
  const lines = linesOf(close, closes.data ?? [], adjustments.data ?? [])
  const latest = Math.max(...siblings.map(c => c.version_no)) === close.version_no
  const unclassified = (accounts.data ?? []).filter(a => a.statement === 'P&L' && !a.pl_line).length
  const stillOpen = lines.filter(a => a.adjustment_state === 'Open').length
  const followUps = lines.filter(a => a.ticket).length
  const editor = canEdit()

  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await work(); setPanel(''); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Could not save') } finally { setBusy(false) }
  }
  const Count = ({ n, label, href }: { n: number; label: string; href: string }) => <a href={href} className="flex flex-col rounded-control bg-subtle px-4 py-3 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
    <span className="text-xl font-semibold text-ink tabular-nums">{n}</span><span className="text-[13px] text-ink-muted">{label}</span></a>

  return <Page title={closeName(close)} count={<StatePill state={close.close_state} />}
    breadcrumb={<a href={to('closes')} className="hover:underline">Monthly Close</a>}
    status={<>The close of <CompanyLink id={close.legal_company} /> for {fmtMonth(close.close_month)}, from the trial balance downloaded {fmtInstantIST(close.downloaded_at)}.
      {close.published_at && <> Published {dayInIndia(close.published_at)} by <PersonName id={close.published_by} />.</>}{' '}
      <RecordLink table="budgets.monthly_close" rowId={id} name="Details And History" href={to('record', `monthly_close/${id}`)} /></>}
    actions={editor && <div className="flex flex-wrap gap-2">
      {close.close_state === 'Open' && <Button onClick={() => setPanel(panel === 'paste' ? '' : 'paste')}>Paste Adjustments</Button>}
      {close.close_state === 'Open' && <Button variant="primary" onClick={() => setPanel(panel === 'publish' ? '' : 'publish')}>Publish</Button>}
      {close.close_state === 'Published' && latest && <Button onClick={() => setPanel(panel === 'next' ? '' : 'next')}>New Version</Button>}
    </div>}>
    {error && <Notice tone="negative">{error}</Notice>}
    <div className="flex flex-wrap gap-3">
      <Count n={unclassified} label="Accounts Not Classified" href={to('accounts', '', { line: 'none' })} />
      <Count n={stillOpen} label="Adjustments Still Open" href={to('adjustments', '', { state: 'Open', month: monthKey(close.close_month) })} />
      <Count n={followUps} label="Follow-ups Raised" href={to('followups')} />
    </div>
    {panel === 'paste' && <PasteRows<CheckedRow<AdjustmentValue>> label="Adjustment lines" noun="adjustment"
      hint="Copy rows from Excel with the headings Store, Account, Amount, Type, Reason and paste them here. Amounts are in rupees; each line takes its P&L line from its account."
      check={pasted => checkAdjustments(pasted, { plants: plants.data ?? [], accounts: accounts.data ?? [], company: close.legal_company })}
      onSave={async (checked) => { await runAction('paste_adjustments', { close: id, values: checked.flatMap(row => row.values) }); await refresh() }} />}
    {panel === 'publish' && <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-ink">Publish {closeName(close)}? Its adjustments can then be matched to SAP and followed up, but not added to or changed.</p>
      <Button variant="primary" loading={busy} onClick={() => run(() => runAction('publish_close', { close: id }))}>Publish {closeName(close)}</Button>
      <Button onClick={() => setPanel('')}>Not Now</Button>
    </div>}
    {panel === 'next' && <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void run(async () => {
      const made = await runAction<{ close: string }>('new_close_version', { close: id, downloaded_at: new Date(downloaded).toISOString() })
      location.hash = to('close', made.close)
    }) }}>
      <label><span className={labelClasses('mb-1')}>New Trial Balance Downloaded At</span><TextInput type="datetime-local" required value={downloaded} onChange={event => setDownloaded(event.target.value)} /></label>
      <Button type="submit" variant="primary" loading={busy}>Make Version {close.version_no + 1}</Button>
      <p className="basis-full text-sm text-ink-muted">Version {close.version_no + 1} carries this version's adjustments and takes new ones. This version is then marked Replaced.</p>
    </form>}
    <h2 className="text-[15px] font-semibold text-ink">Adjustments</h2>
    <AdjustmentTable rows={lines} groupBy="reason" editable={editor} typeFixed={close.close_state !== 'Open'} label={`Adjustments of ${closeName(close)}`} />
  </Page>
}

export function AdjustmentsPage() {
  const route = useRoute()
  const [adjustments, closes, plants] = [useAdjustments(), useCloses(), usePlants()]
  const pick = (key: string) => route.params.get(key) ?? ''
  const groupBy = (pick('group') as GroupBy) || 'reason'
  const monthOf = new Map((closes.data ?? []).map(close => [close.row_id, monthKey(close.close_month)]))
  const rows = (adjustments.data ?? []).filter(a => (!pick('state') || a.adjustment_state === pick('state')) && (!pick('type') || a.adjustment_type === pick('type'))
    && (!pick('store') || a.plant === pick('store')) && (!pick('month') || monthOf.get(a.monthly_close) === pick('month')))
  const months = [...new Set(monthOf.values())].sort().reverse()
  const stores = [...new Set((adjustments.data ?? []).map(a => a.plant))].sort()
  const any = { value: '', label: 'Any' }
  return <Page title="Adjustments" count={`${rows.length} of ${adjustments.data?.length ?? 0}`} status="Every manual line of every close. Amounts are exact rupees.">
    {adjustments.error && <Notice tone="negative">{adjustments.error.message}</Notice>}
    <div className="flex flex-wrap items-end gap-3">
      <Pick label="State" value={pick('state')} onChange={value => route.set({ state: value || null })} options={[any, ...STATES.map(s => ({ value: s, label: s }))]} />
      <Pick label="Type" value={pick('type')} onChange={value => route.set({ type: value || null })} options={[any, ...ADJUSTMENT_TYPES.map(t => ({ value: t, label: t }))]} />
      <Pick label="Store" value={pick('store')} onChange={value => route.set({ store: value || null })} options={[any, ...stores.map(s => ({ value: s, label: `${storeName(plants.data, s)} · ${s}` }))]} />
      <Pick label="Month" value={pick('month')} onChange={value => route.set({ month: value || null })} options={[any, ...months.map(m => ({ value: m, label: fmtMonth(m) }))]} />
      <Pick label="Group By" value={groupBy} onChange={value => route.set({ group: value })} options={[{ value: 'reason', label: 'Reason' }, { value: 'adjustment_type', label: 'Type' }, { value: 'plant', label: 'Store' }, { value: 'adjustment_state', label: 'State' }, { value: 'month', label: 'Month' }]} />
    </div>
    {adjustments.isLoading ? <Skeleton label="Loading adjustments" lines={6} /> : <AdjustmentTable rows={rows} groupBy={groupBy} editable={canEdit()} label="Adjustments" />}
  </Page>
}
