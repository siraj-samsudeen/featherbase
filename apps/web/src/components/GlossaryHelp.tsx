import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { GLOSSARY_PATH, termAnchor, termsDescribing, useGlossary, type GlossaryTerm } from '../lib/glossary'
import { cx, iconButtonClasses } from './ui'
import { CircleHelp } from './ui/icons'

// #629: a "?" after a Table name or a column label that a glossary term
// describes. Pressing it opens the term in place; Escape, a press outside or
// the "?" again closes it. A Table or column no term describes shows nothing.
export function GlossaryHelp({ table, column, className }: { table: string; column?: string; className?: string }) {
  const glossary = useGlossary()
  const terms = termsDescribing(glossary.data?.terms, table, column)
  if (!terms.length) return null
  return (
    // Negative margins: the "?" never makes its line (a field's label) taller.
    <span className={cx('-my-1.5 inline-flex align-middle max-sm:-my-3', className)}>
      {terms.map((term) => <TermHelp key={term.id} term={term} />)}
    </span>
  )
}

const GUTTER = 16
const WIDTH = 320

function TermHelp({ term }: { term: GlossaryTerm }) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const position = useCallback(() => {
    const rect = button.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(WIDTH, window.innerWidth - 2 * GUTTER)
    const left = Math.min(Math.max(rect.left, GUTTER), window.innerWidth - GUTTER - width)
    setPlace({ top: rect.bottom + 4, left, width })
  }, [])

  useLayoutEffect(() => {
    if (open) position()
  }, [open, position])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', position, true)
      window.removeEventListener('resize', position)
    }
  }, [open, position])

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`What is ${term.term}?`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="glossary-help"
        onClick={(e) => {
          // Inside a field's label: never also focus or toggle its control.
          e.preventDefault()
          setOpen((o) => !o)
        }}
        className={iconButtonClasses('size-7 text-ink-subtle hover:text-action max-sm:size-11')}
      >
        <CircleHelp aria-hidden size={16} />
      </button>
      {open && place && createPortal(
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={term.term}
          data-testid="glossary-help-panel"
          style={{ top: place.top, left: place.left, width: place.width }}
          className="fixed z-50 rounded-card border border-border bg-surface p-3 text-left text-sm font-normal text-ink shadow-lg"
        >
          <p className="font-semibold text-ink">{term.term}</p>
          <p className="mt-1 text-ink [overflow-wrap:anywhere]">{term.definition}</p>
          {term.examples.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-ink-muted">
              {term.examples.map((example) => <li key={example}>{example}</li>)}
            </ul>
          )}
          {term.avoid.length > 0 && (
            <p className="mt-2 text-ink-muted">
              <span className="font-medium text-ink">Avoid: </span>
              {term.avoid.map((a) => (a.reason ? `${a.word} (${a.reason})` : a.word)).join(', ')}
            </p>
          )}
          <Link
            to={GLOSSARY_PATH}
            hash={termAnchor(term.id)}
            onClick={() => setOpen(false)}
            className="mt-2 inline-flex min-h-8 items-center text-action underline underline-offset-2 max-sm:min-h-11"
          >
            Open in the glossary
          </Link>
        </div>,
        document.body,
      )}
    </>
  )
}
