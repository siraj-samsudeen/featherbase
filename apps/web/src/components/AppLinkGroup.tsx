import { useState } from 'react'
import { LinkLine, LinkSection, Sentence, ToneChip, fmtCount } from '@featherbase/shop-floor'
import type { RecordGroup, RecordLine } from 'shared'

// #1340: what an app says on a record's Links tab, drawn with the Links tab's own pieces: a line as a sentence (its
// records links), a quiet note under it and a chip saying where it came from; and a group of the app's own, the first
// lines then Show all.

/** The lines of a group shown before Show all. */
export const APP_GROUP_FOLD = 10

/** One of an app's lines. */
export function AppLine({ line, lead }: { line: RecordLine; lead?: React.ReactNode }) {
  return (
    <LinkLine testid="app-line" lead={lead}
      note={line.note && <Sentence parts={line.note} />}
      side={line.chip && <ToneChip tone={line.chip.tone ?? 'quiet'}>{line.chip.label}</ToneChip>}>
      <Sentence parts={line.parts} />
    </LinkLine>
  )
}

/** The app's other ways to see a group (Open as grid, Open as list), on the group's heading line. */
export function AppGroupLinks({ group }: { group: Pick<RecordGroup, 'links'> }) {
  if (!group.links?.length) return null
  return <>{group.links.map((link) => (
    <a key={link.href} href={link.href} data-testid="app-group-link"
      className="shrink-0 rounded-[7px] border border-border-control bg-surface px-2.5 py-1 text-[12.5px] text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus">
      {link.label}
    </a>
  ))}</>
}

/** A group of the app's own lines (a role's People): the first ten, then Show all, or the app's page with all of them. */
export function AppLinkGroup({ group, id }: { group: RecordGroup; id?: string }) {
  const [all, setAll] = useState(false)
  const lines = group.lines ?? []
  const count = group.count ?? lines.length
  const shown = all ? lines : lines.slice(0, APP_GROUP_FOLD)
  return (
    <LinkSection heading={group.heading} count={count} id={id} testid="app-link-group" actions={<AppGroupLinks group={group} />}
      empty={count === 0 ? <p className="px-2 text-sm text-ink-muted">None yet</p> : undefined}>
      {shown.map((line, i) => <AppLine key={i} line={line} />)}
      {/* The first ten, then the rest the app sent; past those, how many more, or the app's page with them all. */}
      {lines.length > APP_GROUP_FOLD && (
        <li className="px-2">
          <button type="button" onClick={() => setAll(!all)} data-testid="app-group-fold"
            className="text-sm font-medium text-action underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
            {all ? 'Show fewer' : `Show all ${fmtCount(lines.length)}`}
          </button>
        </li>
      )}
      {(all || lines.length <= APP_GROUP_FOLD) && count > lines.length && !group.all && <li className="px-2 text-xs text-ink-muted">and {fmtCount(count - lines.length)} more</li>}
      {group.all && <li className="px-2"><a href={group.all.href} className="text-sm font-medium text-action underline-offset-2 hover:underline">{group.all.label}</a></li>}
    </LinkSection>
  )
}

/** The app's group standing for this link group, if any: matched by the Table whose rows point at the record. */
export function appGroupFor(groups: RecordGroup[] | undefined, table: string): RecordGroup | undefined {
  return groups?.find((g) => g.table === table)
}

/** #1340: the key an app's own group answers to, beside the link groups' keys. */
export const appGroupKey = (group: Pick<RecordGroup, 'key'>) => `app:${group.key}`

/** #1340: the link groups in the app's order first (each with what the app says of it), then the rest as they were. */
export function inAppOrder<G extends { connection: { table: string } }>(groups: G[], app: RecordGroup[] | undefined): G[] {
  if (!app?.length) return groups
  const rank = (g: G) => { const i = app.findIndex((a) => a.table === g.connection.table); return i < 0 ? app.length : i }
  return [...groups].sort((a, b) => rank(a) - rank(b))
}
