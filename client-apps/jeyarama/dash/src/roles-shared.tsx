// #1340: what Dash's two explain pages (Explain A Person, Who Would Gain Or Lose Access) and the roles grid share: their
// addresses, one read at a time with its refusal said plainly, names as record links, and how a person stands.
import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, RecordLink as SharedRecordLink, ToneChip } from '@featherbase/shop-floor'
import { read } from './api'
import { LoadFailed } from './sections-page'
import { RecordLink } from './record-link'
import { type Who } from './person-identity'

export const EXPLAIN_ADDRESS = '?view=explain'
export const CHANGES_ADDRESS = '?view=changes'
/** #1282's grid of roles × permissions and reports: Dash's own page, opened from Featherbase's Open as grid. */
export const GRID_ADDRESS = '?view=roles-grid'
/** #1340: the business roles live in Featherbase: its own list and record pages. */
export const FEATHERBASE_ROLES = '/featherbase/admin/table/dash.business_role'
export const featherbaseRole = (id: string) => `${FEATHERBASE_ROLES}/row/${encodeURIComponent(id)}`
export const explainAddress = (person: string) => `${EXPLAIN_ADDRESS}&person=${encodeURIComponent(person)}`
export const ROLE_TABLE = 'dash.business_role'
export const REFUSED = 'Only a Report Access Manager or System Manager can see this'

export interface Part { name: string; table?: string; id?: string; code?: string }
export const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not go through. Try again.')
export const counted = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

/** A name, linked when it names a record; a staff code stays muted after the link, never inside it. */
export function Named({ part }: { part: Part }) {
  const name = part.table ? <RecordLink table={part.table} id={part.id}>{part.name}</RecordLink> : <>{part.name}</>
  return part.code ? <>{name} <span className="text-ink-muted">{part.code}</span></> : name
}
export function Parts({ parts }: { parts: Part[] }) {
  return <>{parts.map((part, i) => <span key={`${part.name}-${i}`}>{i ? ' · ' : ''}<Named part={part} /></span>)}</>
}

/** A person as a link to Explain A Person: the page about them here, not their Featherbase record. */
export function PersonLink({ person, name, testid }: { person: string; name: string; testid?: string }) {
  return <span data-testid={testid}><SharedRecordLink table="Person" rowId={person} name={name} href={explainAddress(person)} /></span>
}

/** #1267's words for whoIs()'s standing: a description only, never what grants access. */
export const STAFF_BADGE = { current: 'Employee', left: 'Former Employee', none: 'External' } as const
export function StaffBadge({ who }: { who: Who | null | undefined }) {
  return <ToneChip testid="staff-badge">{STAFF_BADGE[who?.staff ?? 'none']}</ToneChip>
}

/** One of Dash's reads, asked again on `load`; none while `payload` is null. */
export function useRead<T>(name: string, payload: Record<string, unknown> | null) {
  const [answer, setAnswer] = useState<T | undefined>()
  const [failed, setFailed] = useState<string | null>(null)
  const key = JSON.stringify(payload)
  const load = useCallback(() => {
    if (payload === null) return Promise.resolve()
    setFailed(null)
    return read<T>(name, payload).then(setAnswer, error => setFailed(messageOf(error)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key])
  useEffect(() => { void load() }, [load])
  return { answer, failed, load }
}

/** A failed read: refused (said plainly), or a failure to retry. */
export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  if (message.startsWith('Only a Report Access Manager')) return <Card data-testid="refused"><EmptyState title={REFUSED} body="Ask a System Manager if you need it." /></Card>
  return <LoadFailed onRetry={onRetry} />
}

/**
 * #1340: where an old address of the Business Roles page now lives: the list of business roles in Featherbase, or one
 * role's own record page there. Null for any other address.
 */
export function movedRolesAddress(search: string): string | null {
  const params = new URLSearchParams(search)
  if (params.get('view') !== 'roles') return null
  const role = params.get('role')
  return role ? featherbaseRole(role) : FEATHERBASE_ROLES
}
