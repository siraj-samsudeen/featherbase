// Follow-ups, and the page for any one Budgets record: its fields and its history.
import { DataList, FieldGrid, Notice, RecordLink, Skeleton, fmtDate, fmtExact, fmtInstantIST } from '@featherbase/shop-floor'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { listAll } from './api'
import { canOpen, columnsOf, tableLabel, useActivity, useRecord } from './data'
import { AccountLink, CloseLink, CompanyLink, LineLink, Page, PersonName, RegionLink, RuleLink, SegmentLink, StatePill, StoreLink, VersionLink, num } from './ui'

const TICKET_TYPE = 'Monthly Closing Follow-up'
interface Ticket { row_id: string; title: string; ticket_state: string; assigned_to: string | null; kind: string }

export function FollowUpsPage() {
  const types = useQuery({ queryKey: ['budgets', 'ticket-types'], retry: false, queryFn: () => listAll<{ row_id: string; type_key: string; label: string }>('tickets.ticket_type', { fields: ['row_id', 'type_key', 'label'] }) })
  const type = types.data?.find(t => t.label === TICKET_TYPE)
  const tickets = useQuery({ queryKey: ['budgets', 'follow-ups', type?.type_key], enabled: !!type, retry: false,
    queryFn: () => listAll<Ticket>('tickets.ticket', { fields: ['row_id', 'title', 'ticket_state', 'assigned_to', 'kind'], filters: [['kind', '=', type!.type_key]], order_by: 'created_at desc' }) })
  const open = (tickets.data ?? []).filter(ticket => !['Done', 'Closed', 'Resolved'].includes(ticket.ticket_state))
  return <Page title="Follow-ups" count={type ? `${open.length} open` : undefined} status="Action items raised during a close, as tickets of the type Monthly Closing Follow-up.">
    {types.isLoading ? <Skeleton label="Loading follow-ups" />
      : !type ? <Notice tone="info">The ticket type “{TICKET_TYPE}” is not set up on this instance yet. A System Manager adds it once, in the Tickets app's Ticket Types, with that name. Follow-ups raised with it are then listed here.</Notice>
      : <DataList caption="Open follow-ups" rows={open} rowKey={row => row.row_id} state={tickets.isLoading ? 'loading' : tickets.error ? 'error' : 'ready'} error={tickets.error?.message}
          empty={{ title: 'No Open Follow-ups', body: 'Nothing from a close is waiting on anyone.' }} columns={[
            { key: 'ticket', header: 'Ticket', cell: row => <RecordLink table="tickets.ticket" rowId={row.row_id} name={row.title} detail={row.row_id} href={`/tickets/?ticket=${encodeURIComponent(row.row_id)}`} />, phone: 'title' },
            { key: 'state', header: 'State', cell: row => <StatePill state={row.ticket_state} />, phone: 'status' },
            { key: 'with', header: 'With', cell: row => <PersonName id={row.assigned_to} /> },
          ]} />}
  </Page>
}

const PERSON_COLUMNS = ['owner', 'approved_by', 'published_by']

/** One value of a record, as a link when it is a record itself. */
function value(column: { column_name: string; column_type: string; reference_table?: string }, raw: unknown): ReactNode {
  if (raw == null || raw === '') return ''
  const id = String(raw)
  if (PERSON_COLUMNS.includes(column.column_name)) return <PersonName id={id} />
  if (column.column_name === 'ticket') return <RecordLink table="tickets.ticket" rowId={id} name={id} href={`/tickets/?ticket=${encodeURIComponent(id)}`} />
  if (column.column_name.endsWith('_state')) return <StatePill state={id} />
  switch (column.reference_table) {
    case 'Plant': return <StoreLink id={id} />
    case 'Legal Company': return <CompanyLink id={id} />
    case 'Operating Region': return <RegionLink id={id} />
    case 'Business Line Segment': return <SegmentLink id={id} />
    case 'budgets.pl_line': return <LineLink id={id} />
    case 'budgets.gl_account': return <AccountLink id={id} />
    case 'budgets.budget_version': return <VersionLink id={id} />
    case 'budgets.month_close': return <CloseLink id={id} />
    case 'budgets.allocation_rule': return <RuleLink id={id} />
    case undefined: break
    default: return <RecordLink table={column.reference_table} rowId={id} name={id} canOpen={column.reference_table.startsWith('budgets.') || canOpen(column.reference_table)} />
  }
  if (column.column_type === 'Currency') return fmtExact(num(id))
  if (column.column_type === 'Date') return fmtDate(id.slice(0, 10))
  if (column.column_type === 'Datetime') return fmtInstantIST(id)
  if (column.column_type === 'Check') return raw === true || raw === 1 || raw === '1' ? 'Yes' : 'No'
  return id
}
const said = (v: unknown) => (v == null || v === '' ? 'nothing' : String(v))

export function RecordPage({ path }: { path: string }) {
  const [name, ...rest] = path.split('/')
  const table = `budgets.${name}`
  const id = rest.join('/')
  const record = useRecord(table, id)
  const activity = useActivity(table, id)
  const columns = columnsOf(table)
  const label = (column: string) => columns.find(c => c.column_name === column)?.label ?? column
  if (record.isLoading) return <Page title={tableLabel(table)}><Skeleton label="Loading the record" /></Page>
  if (record.error || !record.data) return <Page title={tableLabel(table)}><Notice tone="negative">There is no {tableLabel(table)} {id}, or you may not see it.</Notice></Page>
  const changes = [...(activity.data?.versions ?? [])].reverse().filter(version => version.data.changed.length)
  return <Page title={tableLabel(table)} count={id}>
    <FieldGrid groups={[{ fields: columns.filter(column => record.data![column.column_name] != null && record.data![column.column_name] !== '').map(column => ({ label: column.label ?? column.column_name, value: value(column, record.data![column.column_name]) })) }]} />
    <section aria-label="History" className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold text-ink">History</h2>
      {activity.data?.created && <p className="text-sm text-ink-muted">Added {fmtInstantIST(activity.data.created.created_at)} by {activity.data.created.author_name}.</p>}
      {changes.length === 0 ? <p className="text-sm text-ink-subtle">No changes since it was added.</p> : <ul className="flex flex-col gap-1.5 text-sm">
        {changes.map((version, index) => <li key={index}><span className="text-ink-muted">{fmtInstantIST(version.created_at)}, {version.author_name}:</span>{' '}
          {version.data.changed.map(([column, before, after]) => `${label(column)} from ${said(before)} to ${said(after)}`).join('; ')}</li>)}
      </ul>}
    </section>
  </Page>
}
