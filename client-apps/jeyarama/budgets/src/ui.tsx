// The pieces every Budgets page shares: the page frame, and each kind of record as a link
// with its readable name beside its code.
import { PageHeader, RecordLink, Select, StatusPill, labelClasses, panelClasses, type StatusTone } from '@featherbase/shop-floor'
import type { ReactNode } from 'react'
import { canOpen, useAccounts, useCloses, useCompanies, useLines, usePeople, usePlants, useRules, useSegments, useVersions, type Close } from './data'
import { to } from './route'
import { fmtMonth } from './words'

/** One page: its heading on the canvas, its content in one white panel that fills the width. */
export function Page({ title, count, status, actions, breadcrumb, children }: { title: ReactNode; count?: ReactNode; status?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode; children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-4">
    <PageHeader title={title} count={count} status={status} actions={actions} breadcrumb={breadcrumb} />
    <section className={panelClasses('flex min-w-0 flex-col gap-4 p-4')}>{children}</section>
  </div>
}

/** A labelled choice in a page's header or above a table. */
export function Pick({ label, value, onChange, options, className }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return <label className={className}>
    <span className={labelClasses('mb-1')}>{label}</span>
    <Select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="min-w-36">
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select>
  </label>
}

const TONES: Record<string, StatusTone> = { Draft: 'caution', Approved: 'positive', Withdrawn: 'missing', Open: 'caution', Published: 'positive', Replaced: 'missing', 'Posted In SAP': 'positive', Released: 'neutral', 'Carried Forward': 'opportunity' }
export const StatePill = ({ state }: { state: string }) => <StatusPill tone={TONES[state] ?? 'neutral'}>{state}</StatusPill>

/** A store: its name, with its plant code beside it. A link where this person can open the plant. */
export function StoreLink({ id, short = false }: { id: string | null | undefined; short?: boolean }) {
  const plant = usePlants().data?.find(p => p.row_id === id)
  if (!id) return null
  return <RecordLink table="Plant" rowId={id} name={plant?.plant_name || `Plant ${id}`} detail={short ? undefined : id} canOpen={canOpen('Plant')} />
}
export const storeName = (plants: { row_id: string; plant_name: string | null }[] | undefined, id: string) => plants?.find(p => p.row_id === id)?.plant_name || `Plant ${id}`

export function CompanyLink({ id }: { id: string | null | undefined }) {
  const company = useCompanies().data?.find(c => c.row_id === id)
  return id ? <RecordLink table="Legal Company" rowId={id} name={company?.name || `Company ${id}`} detail={id} canOpen={canOpen('Legal Company')} /> : null
}
export function SegmentLink({ id }: { id: string }) {
  const segment = useSegments().data?.find(s => s.row_id === id)
  return <RecordLink table="Business Line Segment" rowId={id} name={segment?.name || `Segment ${id}`} canOpen={canOpen('Business Line Segment')} />
}
export const RegionLink = ({ id }: { id: string | null | undefined }) => id ? <RecordLink table="Operating Region" rowId={id} name={id} canOpen={canOpen('Operating Region')} /> : null

export function LineLink({ id }: { id: string | null | undefined }) {
  const line = useLines().data?.find(l => l.row_id === id)
  return id ? <RecordLink table="budgets.pl_line" rowId={id} name={line?.line_name ?? id} /> : null
}
export function AccountLink({ id }: { id: string | null | undefined }) {
  const account = useAccounts().data?.find(a => a.row_id === id)
  return id ? <RecordLink table="budgets.gl_account" rowId={id} name={account?.account_name ?? `Account ${id}`} detail={id} /> : null
}
export function VersionLink({ id }: { id: string | null | undefined }) {
  const version = useVersions().data?.find(v => v.row_id === id)
  return id ? <RecordLink table="budgets.budget_version" rowId={id} name={version?.version_name ?? id} /> : null
}
export const closeName = (close: Pick<Close, 'close_month' | 'version_no'>) => `${fmtMonth(close.close_month)} Version ${close.version_no}`
export function CloseLink({ id }: { id: string | null | undefined }) {
  const close = useCloses().data?.find(c => c.row_id === id)
  return id ? <RecordLink table="budgets.month_close" rowId={id} name={close ? closeName(close) : id} /> : null
}
export function RuleLink({ id }: { id: string }) {
  const rule = useRules().data?.find(r => r.row_id === id)
  return <RecordLink table="budgets.allocation_rule" rowId={id} name={rule?.rule_name ?? id} />
}
/** A person the tables hold by ID, by name. Budgets people cannot open the Person table, so this is plain text unless they can. */
export function PersonName({ id }: { id: string | null | undefined }) {
  const person = usePeople().data?.find(p => p.row_id === id)
  return id ? <RecordLink table="Person" rowId={id} name={person?.full_name ?? 'Someone no longer in Budgets'} canOpen={canOpen('Person')} /> : null
}

/** Where each of the app's own records opens: its page here. */
export function pageFor(table: string, rowId: string): string | undefined {
  if (table === 'budgets.budget_version') return to('version', rowId)
  if (table === 'budgets.month_close') return to('close', rowId)
  if (table === 'budgets.allocation_rule') return to('rule', rowId)
  if (table.startsWith('budgets.')) return to('record', `${table.slice(8)}/${rowId}`)
  return undefined
}

/** An amount as a number, however the server sent it. */
export const num = (value: string | number | null | undefined) => (value == null || value === '' ? 0 : Number(value))
