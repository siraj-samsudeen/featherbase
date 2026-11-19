import { personMeta, type PersonLabel as Label, type PersonMetaPart } from 'shared'
import { cx } from './cx'
import { RecordLink } from './RecordLink'

// #1345: the Person Label. One component for every place that names a person, so
// people who share a name are told apart everywhere alike: the name as a link to
// the Person, then muted `employee code · role · place`. The words come from
// `personMeta` (shared); the values from the server's person labels.

/** Which part a narrow inline label drops first: the role, then the place; never the code. */
const DROP: Partial<Record<PersonMetaPart['kind'], string>> = {
  role: '@max-[22rem]:hidden',
  place: '@max-[14rem]:hidden',
}

function Meta({ parts, layout }: { parts: PersonMetaPart[]; layout: 'stacked' | 'inline' }) {
  return (
    <span data-testid="person-meta" className={layout === 'stacked' ? 'wrap-anywhere' : 'min-w-0'}>
      {parts.map((part, i) => (
        <span key={part.kind} data-part={part.kind}
          className={cx(layout === 'inline' && DROP[part.kind], part.kind === 'code' && 'whitespace-nowrap')}>
          {i > 0 && ' · '}{part.text}
        </span>
      ))}
    </span>
  )
}

/** "+1 code": the person's other current codes, listed on hover or focus; each a link where the viewer may open it. */
function MoreCodes({ codes, inLink }: { codes: NonNullable<Label['more_codes']>; inLink: boolean }) {
  const words = `+${codes.length} ${codes.length === 1 ? 'code' : 'codes'}`
  return (
    <span className="group relative inline-flex shrink-0 self-start" data-testid="person-more-codes">
      <span tabIndex={inLink ? undefined : 0} title={inLink ? codes.map((c) => c.code).join(', ') : undefined}
        className="rounded-control border border-border px-1.5 text-xs text-ink-muted focus-visible:outline-2 focus-visible:outline-focus">
        {words}
      </span>
      {/* Inside a row that is itself a link, the codes are the chip's title: a link may not hold links. */}
      {!inLink && (
        <span role="list" className="absolute top-full left-0 z-10 mt-1 hidden min-w-max flex-col gap-1 rounded-control border border-border bg-surface p-2 text-xs shadow-sm group-focus-within:flex group-hover:flex">
          {codes.map((c) => (
            <span role="listitem" key={c.code}>
              {c.table && c.row_id ? <RecordLink table={c.table} rowId={c.row_id} name={c.code} /> : c.code}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

/**
 * A person, named so they can be told apart.
 *
 * - `layout="stacked"` (search, pickers, record headers, Recently Opened): the
 *   words on a second line, wrapping on a phone, never sideways.
 * - `layout="inline"` (reference cells, activity lines): after the name; a narrow
 *   space drops the role first, then the place, never the code.
 * - `withEmail` adds the email where two people would otherwise read the same.
 * - `inLink`: inside a row that is itself the link to this person.
 */
export function PersonLabel({
  rowId, name, label, layout = 'stacked', withEmail = false, canOpen = true, inLink = false, onNavigate, className,
}: {
  rowId: string
  name: string
  label?: Label
  layout?: 'stacked' | 'inline'
  withEmail?: boolean
  canOpen?: boolean
  inLink?: boolean
  onNavigate?: (href: string) => void
  className?: string
}) {
  const parts = personMeta(label, { withEmail })
  const more = label?.more_codes?.length ? <MoreCodes codes={label.more_codes} inLink={inLink} /> : null
  return (
    <span data-testid="person-label" className={cx('@container inline-flex min-w-0 max-w-full items-start gap-2', className)}>
      <RecordLink
        table="Person" rowId={rowId} name={name} canOpen={canOpen} inLink={inLink} onNavigate={onNavigate}
        layout={layout === 'stacked' ? 'two-lines' : 'inline'}
        detail={parts.length ? <Meta parts={parts} layout={layout} /> : null}
      />
      {more}
    </span>
  )
}
