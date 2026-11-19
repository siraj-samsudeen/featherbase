import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appHref, type WorkedOutAnswer, type WorkedOutRow } from 'shared'
import { CountChip, Lock, RecordLink, fmtCount, touchLinkClasses } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import type { NavPane } from '../lib/nav-path'

// #1282 C10–C11 (UI owner, option A): the sections an installed app works out about the record in the
// Lens ("Apps They Can Open · worked out from their roles"), drawn with the Lens's own group and row
// styles (LinkedRowsGroup). Each row's tick is locked: it comes from a role, so it is changed on the
// role. Why? opens the one-line chain, offered only where the app gave one for this viewer.

const LOCKED = 'Comes from a role; change it on the role'

function useWorkedOut(table: string, row: string) {
  return useQuery({
    queryKey: ['worked-out', table, row],
    retry: false,
    queryFn: () => api.get<WorkedOutAnswer>(`/api/worked-out/${encodeURIComponent(table)}/${encodeURIComponent(row)}`),
  })
}

/** The id a worked-out section answers to, so its chip in the count row can jump to it (#1349). */
export const workedOutId = (heading: string) => `worked-out-${heading.replace(/[^A-Za-z0-9_-]/g, '_')}`

/** #1349 (board 4b): each worked-out section as a chip in the count row, "3 Apps They Can Open"; an empty one quiet
 *  and grey, since its section below says the check ran. */
export function WorkedOutCounts({ table, row, onSection, size }: {
  table: string; row: string; onSection: (heading: string) => void; size?: 'page' | 'pane'
}) {
  const answer = useWorkedOut(table, row)
  return <>{(answer.data?.sections ?? []).map((section) => (
    <CountChip key={section.heading} count={section.rows.length} label={section.heading} size={size} onSelect={() => onSection(section.heading)} />
  ))}</>
}

export function WorkedOutSections({ table, row, onOpen }: { table: string; row: string; onOpen?: (pane: NavPane) => void }) {
  const answer = useWorkedOut(table, row)
  // Nothing worked out, or the app's answer refused: the panel shows its own groups only.
  if (!answer.data?.sections.length) return null
  // Each section is headed as a linked group (LinkedRowsGroup), the rows beside it on the Lens and the Links tab
  // (consistency check): the label, its count and note muted, the heading greyed when the section is empty.
  return <>{answer.data.sections.map((section) => (
    <section key={section.heading} id={workedOutId(section.heading)} tabIndex={-1} aria-label={section.heading} data-testid="worked-out-section"
      className="flex min-w-0 scroll-mt-4 flex-col gap-3 focus:outline-none">
      <h4 className={section.rows.length ? 'text-sm font-semibold text-ink' : 'text-sm font-semibold text-ink-muted'}>
        {section.heading} <span className="font-normal text-ink-muted">{fmtCount(section.rows.length)}{section.note ? ` · ${section.note}` : ''}</span>
      </h4>
      {/* An empty section keeps its heading, so people see the check was done (UI owner). */}
      {section.rows.length === 0
        ? <p className="text-sm text-ink-muted" data-testid="worked-out-empty">{section.empty}</p>
        : <ul className="flex min-w-0 flex-col gap-0.5">{section.rows.map((r, i) => <WorkedOutLine key={i} row={r} onOpen={onOpen} />)}</ul>}
    </section>
  ))}</>
}

const link = (named: { name: string; record?: { table: string; row: string } }, onOpen?: (pane: NavPane) => void) => (named.record
  ? <RecordLink table={named.record.table} rowId={named.record.row} name={named.name}
      onNavigate={onOpen ? () => onOpen({ table: named.record!.table, row: named.record!.row }) : undefined} />
  : <span>{named.name}</span>)

function WorkedOutLine({ row, onOpen }: { row: WorkedOutRow; onOpen?: (pane: NavPane) => void }) {
  const [open, setOpen] = useState(false)
  return (
    // The tick list's line: a 22px column for the (locked) tick, the name, its facts small beneath, as a Lens row.
    <li className="grid min-w-0 grid-cols-[22px_minmax(0,1fr)] gap-x-2 rounded-control px-2 py-1.5 text-[13px] hover:bg-subtle" data-testid="worked-out-row">
      <span title={LOCKED} aria-label={LOCKED} role="img" className="pt-0.5 text-ink-subtle" data-testid="worked-out-lock"><Lock aria-hidden size={14} /></span>
      <div className="flex min-w-0 flex-col">
        {/* An app's name opens the app itself, as the app switcher does (UI owner); the level beneath is words. */}
        <span className="min-w-0">{row.app ? <RecordLink table="App" rowId={row.app} name={row.name} href={appHref(row.app)} /> : link(row, onOpen)}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          {row.detail && <span>{row.detail}</span>}
          {row.via.map((v, i) => (
            // The role that gives it, a link styled as the tag chip.
            <span key={i} className="inline-block rounded-full bg-tag px-2 py-px text-xs text-ink-muted" data-testid="worked-out-via">via {link(v, onOpen)}</span>
          ))}
          {/* Why? only where the app gave this viewer the chain; never a locked or empty Why (UI owner). */}
          {row.why && (
            <button type="button" className={touchLinkClasses('text-action hover:underline')} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="worked-out-why">
              {open ? 'Hide why' : 'Why?'}
            </button>
          )}
        </div>
        {open && row.why && (
          <p className="mt-1 text-ink-muted" data-testid="worked-out-chain">
            {row.why.map((part, i) => (
              <span key={i}>{i ? ' → ' : ''}{link(part, onOpen)}
                {part.detailParts && <> ({part.detailParts.map((p, j) => <span key={j}>{j ? ' · ' : ''}{link(p, onOpen)}</span>)})</>}
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  )
}
