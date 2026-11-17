import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'
import { fmtCount } from './format'

export interface FieldGridField {
  label: string
  value: ReactNode
  /** Collapsed with the grid's other empty fields under "n empty fields". */
  empty?: boolean
  /** Clamped to three lines with Show more / Show less. */
  long?: boolean
}
export interface FieldGridGroup {
  title?: string
  fields: FieldGridField[]
}

// Labels keep their words whole; values wrap anywhere so a long code never widens the page.
const GRID = 'grid grid-cols-[minmax(6rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm'
const LABEL = 'text-ink-muted break-normal hyphens-none'
const VALUE = 'min-w-0 text-ink wrap-anywhere'

function LongValue({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  // Until it is measured (and in a test, with no layout) assume it overflows.
  const [overflows, setOverflows] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !open && el.clientHeight > 0) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [open, children])
  return (
    <div className="flex flex-col items-start gap-1">
      <div ref={ref} className={cx('whitespace-pre-line', !open && 'line-clamp-3')}>{children}</div>
      {overflows && <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="text-sm font-medium text-action hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        {open ? 'Show less' : 'Show more'}
      </button>}
    </div>
  )
}

/** Two columns, each label over its value; a long value takes the row (a record panel, #1259). */
const STACKED = 'grid grid-cols-2 gap-x-6 gap-y-3 text-sm'

function Rows({ fields, stacked = false }: { fields: FieldGridField[]; stacked?: boolean }) {
  if (stacked) return <dl className={STACKED}>
    {fields.map((field, index) => <div key={`${index}-${field.label}`} className={cx('flex min-w-0 flex-col gap-0.5', field.long && 'col-span-2')}>
      <dt className={cx(LABEL, 'text-xs')}>{field.label}</dt>
      <dd className={VALUE}>{field.long ? <LongValue>{field.value}</LongValue> : field.value}</dd>
    </div>)}
  </dl>
  return <dl className={GRID}>
    {fields.map((field, index) => <div key={`${index}-${field.label}`} className="contents">
      <dt className={LABEL}>{field.label}</dt>
      <dd className={VALUE}>{field.long ? <LongValue>{field.value}</LongValue> : field.value}</dd>
    </div>)}
  </dl>
}

/**
 * A row's fields, read only: label / value in two columns, grouped into
 * sections. Every empty field gathers under one closed "n empty fields".
 */
export function FieldGrid({ groups, stacked = false }: {
  groups: FieldGridGroup[]
  /** Each label over its value, in two columns (a record panel); else label beside value. */
  stacked?: boolean
}) {
  const empty = groups.flatMap((group) => group.fields.filter((field) => field.empty))
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((group, index) => {
        const filled = group.fields.filter((field) => !field.empty)
        if (!filled.length) return null
        return <section key={`${index}-${group.title ?? ''}`} className="flex flex-col gap-2">
          {group.title && <h3 className="text-sm font-semibold text-ink">{group.title}</h3>}
          <Rows fields={filled} stacked={stacked} />
        </section>
      })}
      {empty.length > 0 && <details className="group">
        <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
          {fmtCount(empty.length)} empty {empty.length === 1 ? 'field' : 'fields'}
        </summary>
        <div className="pt-2"><Rows fields={empty.map((field) => ({ ...field, value: '—' }))} stacked={stacked} /></div>
      </details>}
    </div>
  )
}
