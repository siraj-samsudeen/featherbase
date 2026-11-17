import { useQuery } from '@tanstack/react-query'
import { RecordLink, StatusPill, type StatusTone } from '@featherbase/shop-floor'
import { api } from '../lib/api'

/** #1267 step 3: who a person is to the organisation, as the people app says it. */
export interface Standing {
  status: 'current' | 'left' | 'none' | 'unknown'
  code: string | null
  jobs: { job: string; site?: { table: string; id: string; name: string } }[]
  external_label: string | null
}

export const standingQuery = (person: string) => ({
  queryKey: ['person-standing', person],
  queryFn: () => api.get<Standing>(`/api/people/${encodeURIComponent(person)}/standing`),
  staleTime: 60_000,
  retry: false,
})

export function usePersonStanding(person: string) {
  return useQuery(standingQuery(person))
}

const BADGE: Record<Exclude<Standing['status'], 'unknown'>, { words: string; why: string; tone: StatusTone }> = {
  current: { words: 'Employee', why: 'Has a current employee record', tone: 'neutral' },
  left: { words: 'Former Employee', why: 'Has only past employee records', tone: 'missing' },
  none: { words: 'External', why: 'Has no employee record', tone: 'caution' },
}

/** Under a Person's name: the badge, each job with its store, and the email. An
 *  unknown standing (the app could not say) shows no badge rather than a guess. */
export function PersonStanding({ person, email }: { person: string; email?: string | null }) {
  const standing = usePersonStanding(person)
  const s = standing.data
  const badge = s && s.status !== 'unknown' ? BADGE[s.status] : null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted" data-testid="person-standing">
      {badge && (
        <span title={badge.why} data-testid="person-standing-badge">
          <StatusPill tone={badge.tone}>{badge.words}{s!.status === 'none' && s!.external_label ? ` · ${s!.external_label}` : ''}</StatusPill>
        </span>
      )}
      {s?.jobs.map((j, i) => (
        <span key={`${j.job}-${j.site?.id ?? i}`} data-testid="person-standing-job">
          {j.job}{j.site && <>{' · '}<RecordLink table={j.site.table} rowId={j.site.id} name={j.site.name} /></>}
        </span>
      ))}
      {email && <span data-testid="person-standing-email">{email}</span>}
    </div>
  )
}
