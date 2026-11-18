import { useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { whyAnswerSchema, type WhyAnswer, type WhyBox, type WhyExplained, type WhyOffer } from 'shared'
import { RecordLink } from '@featherbase/shop-floor'
import { api } from '../lib/api'

// #1282 Why mode (E6–E8): the record Map's second view, an installed app's
// explanation of one record, drawn as columns of boxes (Person → Business Role ·
// Area → App · Level → What They Can Do). The server decides everything: whether
// it is offered (whyOfferQuery), and an answer already checked against the one
// shape, its unreadable records named neutrally. Clicking a box lights every
// chain that leads to it, back to the first column; clicking it again clears it.

const whyPath = (table: string, row: string) => `/api/why/${encodeURIComponent(table)}/${encodeURIComponent(row)}`

/** Whether the Map offers Why for this record, and the toggle's words: the server's answer, never guessed here. */
export function whyOfferQuery(table: string, row: string) {
  return {
    queryKey: ['why-offer', table, row],
    queryFn: () => api.get<WhyOffer>(whyPath(table, row)),
    retry: false,
  }
}

/** The boxes and edges lit for `hot`: it, and every chain leading to it, back to the first column. */
export function litChains(answer: WhyAnswer, hot: string | null): { boxes: Set<string>; edges: Set<number> } {
  const boxes = new Set<string>()
  const edges = new Set<number>()
  if (!hot) return { boxes, edges }
  boxes.add(hot)
  const frontier = [hot]
  while (frontier.length) {
    const to = frontier.pop()!
    answer.edges.forEach(([from, end], i) => {
      if (end !== to || edges.has(i)) return
      edges.add(i)
      if (!boxes.has(from)) { boxes.add(from); frontier.push(from) }
    })
  }
  return { boxes, edges }
}

export function WhyMap({ table, row }: { table: string; row: string }) {
  const explained = useQuery({
    queryKey: ['why-explain', table, row],
    queryFn: () => api.get<WhyExplained>(`${whyPath(table, row)}/explain`),
    retry: false,
  })
  const [hot, setHot] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  // Verifier: checked here too, against the same shape, so nothing the server did not pass is ever half drawn.
  const checked = explained.data ? whyAnswerSchema.safeParse(explained.data.answer) : undefined
  const answer = checked?.success ? checked.data : undefined
  const lit = answer ? litChains(answer, hot) : { boxes: new Set<string>(), edges: new Set<number>() }
  const lines = useWhyLines(frame, answer)

  if (explained.isPending) return <p className="text-sm text-ink-subtle" data-testid="why-map">Loading…</p>
  // A refusal or an answer the server would not pass: never a half-drawn map.
  if (!answer) return <p className="text-sm text-ink-muted" data-testid="why-map" role="status">Can't explain this right now</p>
  const toggle = (id: string) => setHot((was) => (was === id ? null : id))

  return (
    <div ref={frame} data-testid="why-map" className="relative overflow-x-auto">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" data-testid="why-edges">
        {lines.map((l) => (
          <path key={l.index} d={l.d} fill="none" data-lit={lit.edges.has(l.index) ? 'true' : undefined}
            stroke={lit.edges.has(l.index) ? 'var(--color-action)' : 'var(--color-border)'} strokeWidth={lit.edges.has(l.index) ? 2 : 1.5} />
        ))}
      </svg>
      <div className="relative grid auto-cols-[minmax(10rem,13rem)] grid-flow-col gap-x-12">
        {answer.columns.map((column, c) => (
          <section key={c} aria-label={column.heading} className="flex min-w-0 flex-col gap-3">
            <h3 className="text-xs font-semibold text-ink-muted">{column.heading}</h3>
            <div className="flex flex-1 flex-col justify-center gap-3">
              {column.boxes.map((box) => (
                <Box key={box.id} box={box} first={c === 0} lit={lit.boxes.has(box.id)} pressed={hot === box.id} onToggle={() => toggle(box.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/** One box: its name (a link where it names a record), its detail and where it came from, and Show Chain. */
function Box({ box, first, lit, pressed, onToggle }: { box: WhyBox; first: boolean; lit: boolean; pressed: boolean; onToggle: () => void }) {
  // A click on the box lights its chains; a click on its link opens the record instead.
  const onClick = (event: MouseEvent) => {
    if (!(event.target as Element).closest('a,button')) onToggle()
  }
  const source = box.source === 'hr' ? 'HR' : box.source === 'hand' ? 'by hand' : undefined
  // An area's parts each name their record: a link (#1282 item 12), else plain words.
  const parts = (box.detailParts ?? (box.detail ? [{ name: box.detail }] : [])).concat(source ? [{ name: source }] : [])
  return (
    <div data-testid="why-box" data-why-box={box.id} data-lit={lit ? 'true' : undefined} onClick={onClick}
      className={`min-w-0 cursor-pointer rounded-lg border px-3 py-2 text-sm ${lit ? 'border-action bg-action-tint' : first ? 'border-action bg-surface' : 'border-border bg-surface'}`}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 break-words font-medium text-ink">
          {box.record ? <RecordLink table={box.record.table} rowId={box.record.row} name={box.name} /> : box.name}
        </span>
        {box.reach && <span className="shrink-0 rounded-full bg-subtle px-2 text-xs text-ink-muted" data-testid="why-reach">{box.reach}</span>}
      </div>
      {parts.length > 0 && (
        <div className="text-xs text-ink-muted" data-testid="why-detail">
          {parts.map((part, i) => (
            <span key={i}>{i > 0 && ' · '}{'record' in part && part.record
              ? <RecordLink table={part.record.table} rowId={part.record.row} name={part.name} />
              : part.name}</span>
          ))}
        </div>
      )}
      <button type="button" onClick={onToggle} aria-pressed={pressed} aria-label={`${pressed ? 'Hide' : 'Show'} the chain to ${box.name}`}
        className="mt-1 rounded px-1 text-xs text-ink-muted hover:text-action focus-visible:outline-2 focus-visible:outline-focus">
        {pressed ? 'Hide Chain' : 'Show Chain'}
      </button>
    </div>
  )
}

/** The edges as curves, measured where the boxes fall: from a box's right edge to the next box's left. */
function useWhyLines(frame: RefObject<HTMLDivElement | null>, answer: WhyAnswer | undefined): { index: number; d: string }[] {
  const [lines, setLines] = useState<{ index: number; d: string }[]>([])
  useLayoutEffect(() => {
    const el = frame.current
    const draw = () => {
      const next: { index: number; d: string }[] = []
      if (el && answer) {
        const box = el.getBoundingClientRect()
        const at = (id: string) => el.querySelector(`[data-why-box="${CSS.escape(id)}"]`)?.getBoundingClientRect()
        answer.edges.forEach(([from, to], index) => {
          const a = at(from)
          const b = at(to)
          if (!a?.width || !b?.width) return
          const x1 = a.right - box.left
          const y1 = a.top + a.height / 2 - box.top
          const x2 = b.left - box.left
          const y2 = b.top + b.height / 2 - box.top
          const mx = (x1 + x2) / 2
          next.push({ index, d: `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` })
        })
      }
      setLines((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next))
    }
    draw()
    if (!el || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(draw)
    watch.observe(el)
    return () => watch.disconnect()
  })
  return lines
}
