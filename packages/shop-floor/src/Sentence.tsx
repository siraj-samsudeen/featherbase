import { RecordLink } from './RecordLink'

// #1282 H1–H4: a permission or a report grant said as one line, the same everywhere
// it shows: "[Store Managers] can Edit Sections (in their area)". Records are links;
// the reach is said once, as a muted chip (neutral: reach is neither good nor bad).

export type SentencePart =
  | string
  | { record: { table: string; row: string; name: string; canOpen?: boolean } }
  | { chip: string }

/** The sentence as one line of links and words, its reach a chip. */
export function Sentence({ parts, className }: { parts: SentencePart[]; className?: string }) {
  return (
    <span className={className} data-testid="sentence">
      {parts.map((part, i) => typeof part === 'string' ? <span key={i}>{part}</span>
        : 'record' in part ? <RecordLink key={i} table={part.record.table} rowId={part.record.row} name={part.record.name} canOpen={part.record.canOpen ?? true} />
        : <span key={i} className="mx-0.5 inline-block rounded-full bg-subtle px-2 py-px text-xs text-ink-muted" data-testid="sentence-reach">{part.chip}</span>)}
    </span>
  )
}

/** The same sentence as plain words, where links cannot go (a tooltip): "Store Managers can Edit Sections in their area". */
export function sentenceText(parts: SentencePart[]): string {
  return parts.map((part) => typeof part === 'string' ? part : 'record' in part ? part.record.name : ` ${part.chip}`)
    .join('').replace(/\s+/g, ' ').trim()
}
