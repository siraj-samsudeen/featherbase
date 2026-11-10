import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { api } from '../lib/api'
import { announceBarChange, useBarAddress } from '../lib/bar-address'
import { cx } from '@featherbase/shop-floor'
import { Check, ChevronDown } from '@featherbase/shop-floor'

// #642 (design E8): the controls an app declares for the shared top bar,
// drawn by the platform — the app never runs its own code in the bar
// (ADR 0011). Each picker is filled from the app's own read, run on the
// server under the reader's scope (`GET /api/app_bar/:app`), and keeps its
// choice in the address (`?<sets>=<value>`), where the app reads it.
//
// The approved look (owner, #642): the declared word as a muted label, then a
// trigger with the value and a chevron; an open list where the current option
// is ticked and bold and the active one is tinted. On a phone the label is
// visually hidden (still the accessible name) and the value is cut with an
// ellipsis. One option shows as plain text; none hides the control.

interface BarOption {
  value: string
  label: string
}
interface BarControl {
  picker: string
  sets: string
  options: BarOption[]
  /** #975: stays away from a page whose address carries this key. */
  hiddenWhen?: string
  /** #967: address keys the options depend on; the bar asks again when one changes. */
  dependsOn?: string[]
}

/** The controls the bar shows for `app`: those with at least one option, on a page they apply to. */
export function useBarControls(app: string | undefined) {
  const page = useBarAddress()
  const location = useRouterState({ select: (state) => state.location })
  const address = new URLSearchParams(page ? page.search : location.searchStr)
  // Only a key this app's controls depend on asks again: the keys come from the last answer, and
  // every value they hold goes with the request, so a key's change is a new query.
  const queryClient = useQueryClient()
  const known = queryClient.getQueryData<{ controls: BarControl[] }>(['app_bar', app, 'keys'])
  const keys = [...new Set((known?.controls ?? []).flatMap((control) => control.dependsOn ?? []))].sort()
  const depends = new URLSearchParams(keys.flatMap((key) => (address.has(key) ? [[key, address.get(key)!]] : []))).toString()
  const bar = useQuery({
    queryKey: ['app_bar', app, depends],
    queryFn: async () => {
      const answer = await api.get<{ controls: BarControl[] }>(`/api/app_bar/${encodeURIComponent(app!)}${depends ? `?${depends}` : ''}`)
      queryClient.setQueryData(['app_bar', app, 'keys'], answer)
      return answer
    },
    enabled: Boolean(app),
    retry: false,
  })
  return (bar.data?.controls ?? []).filter((control) =>
    control.options.length > 0 && !(control.hiddenWhen && address.has(control.hiddenWhen)))
}

export function BarControls({ app }: { app: string }) {
  const controls = useBarControls(app)
  if (controls.length === 0) return null
  return (
    <div className="flex min-w-0 shrink items-center gap-2 max-sm:pl-1" data-testid="bar-controls">
      {controls.map((control) => (
        <BarPicker key={control.sets} control={control} />
      ))}
    </div>
  )
}

/** The value a key holds in the address, read and written through the
 *  router, so a choice is a history entry and never a full reload. `fill`
 *  writes a value in place of the current entry instead: no Back step. Both
 *  announce the value to the page. */
function useAddressValue(key: string): [string | null, (value: string) => void, (value: string) => void] {
  const router = useRouter()
  const location = useRouterState({ select: (state) => state.location })
  // #650: on an app's own page the document's address, not the bar's router.
  const page = useBarAddress()
  const value = new URLSearchParams(page ? page.search : location.searchStr).get(key)
  function write(next: string, replace: boolean) {
    if (page) page.set(key, next, { replace })
    else {
      // The address as it is now, not as this render saw it: another control
      // may have just written its own value (Codex round 1 on #658).
      const now = router.history.location
      const params = new URLSearchParams(now.search)
      params.set(key, next)
      const href = `${now.pathname}?${params.toString()}${now.hash}`
      if (replace) router.history.replace(href)
      else router.history.push(href)
    }
    announceBarChange(key, next)
  }
  return [value, (next) => write(next, false), (next) => write(next, true)]
}

const LABEL = 'text-sm text-ink-muted max-sm:sr-only'
/** #1153: more options than this, and the open list starts with a filter box. */
const FILTER_FROM = 10
/** The shortest the list gets, even with little room below the picker. */
const MIN_LIST_HEIGHT = 120

function BarPicker({ control }: { control: BarControl }) {
  const { options } = control
  const labelId = useId()
  const listId = useId()
  const [value, setValue, fillValue] = useAddressValue(control.sets)
  const chosen = options.some((option) => option.value === value)
  // Owner decision (27-Oct-2026, #650): with no choice in the address, or one
  // that is not among the reader's options, the first option is written in
  // place, so the app and a shared link always see an explicit choice. The
  // guard only stops a strict-mode second run announcing it twice: once a
  // valid value is seen it is cleared, so returning to a wrong value later
  // (history, or the app's own navigation) is corrected again.
  const filledFor = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (chosen) {
      filledFor.current = undefined
      return
    }
    if (filledFor.current === value) return
    filledFor.current = value
    fillValue(options[0].value)
  })
  const currentIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const current = options[currentIndex]
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(currentIndex)
  const optionId = (index: number) => `${listId}-${index}`
  // #1153: a long list gets a filter box, and never runs past the window's bottom edge.
  const filterable = options.length > FILTER_FROM
  const [query, setQuery] = useState('')
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const filter = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLowerCase()
  // The options on show, by their index in `options`.
  const shown = options.flatMap((option, index) => (!needle || option.label.toLowerCase().includes(needle) ? [index] : []))
  // The room below the picker: the list starts 4px under it and stops 8px above the window's edge.
  const fit = () => {
    const bottom = trigger.current?.getBoundingClientRect().bottom ?? 0
    setMaxHeight(Math.max(MIN_LIST_HEIGHT, window.innerHeight - bottom - 4 - 8))
  }
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  })
  useEffect(() => {
    if (open && filterable) filter.current?.focus()
  }, [open, filterable])
  // The highlighted option stays in view as the keys move it.
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  if (options.length === 1)
    return (
      <div className="flex min-w-0 items-center gap-2" data-testid={`bar-control-${control.sets}`}>
        <span id={labelId} className={LABEL}>
          {control.picker}
        </span>
        <span className="truncate text-sm text-ink max-sm:max-w-44">
          {current.label}
        </span>
      </div>
    )

  function show() {
    setActive(currentIndex)
    setQuery('')
    fit()
    setOpen(true)
  }
  function close(refocus = false) {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  function choose(index: number) {
    close(filterable)
    const option = options[index]
    if (option && option.value !== value) setValue(option.value)
  }
  /** Focus leaving the picker and its list closes the list; moving between them doesn't. */
  function onBlur(event: FocusEvent) {
    if (event.relatedTarget instanceof Node && box.current?.contains(event.relatedTarget)) return
    setOpen(false)
  }
  /** The keys of an open list, over the options on show. True when the key was used. */
  function moveOrChoose(event: KeyboardEvent<HTMLElement>): boolean {
    const at = Math.max(0, shown.indexOf(active))
    const last = shown.length - 1
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, at + 1),
      ArrowUp: () => Math.max(0, at - 1),
      PageDown: () => last,
      PageUp: () => 0,
      // In the filter box Home and End move the caret.
      ...(filterable ? {} : { Home: () => 0, End: () => last }),
    }
    if (moves[event.key]) {
      event.preventDefault()
      if (shown.length) setActive(shown[moves[event.key]()])
    } else if (event.key === 'Enter' || (event.key === ' ' && !filterable)) {
      event.preventDefault()
      if (shown.includes(active)) choose(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      setOpen(false)
    } else return false
    return true
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        show()
      }
      return
    }
    moveOrChoose(event)
  }
  function onFilter(next: string) {
    setQuery(next)
    const needle = next.trim().toLowerCase()
    const first = options.findIndex((option) => !needle || option.label.toLowerCase().includes(needle))
    if (first >= 0) setActive(first)
  }

  return (
    <div ref={box} className="flex min-w-0 items-center gap-2 sm:relative" data-testid={`bar-control-${control.sets}`}>
      <span id={labelId} className={LABEL}>
        {control.picker}
      </span>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && !filterable ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        data-testid={`bar-picker-${control.sets}`}
        className={cx(
          'inline-flex min-h-control min-w-0 max-w-64 items-center gap-2 rounded-control border border-border-control bg-surface px-3',
          'text-sm text-ink hover:bg-subtle max-sm:max-w-44',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown aria-hidden size={16} className="shrink-0 text-ink-muted" />
      </button>
      <div
        hidden={!open}
        style={{ maxHeight }}
        // On a phone the list spans the bar (the header is its frame), so a long
        // option is never cut at either edge of the screen.
        className="absolute top-full z-30 mt-1 flex flex-col rounded-card border border-border bg-surface p-1 shadow-lg max-sm:inset-x-2 sm:left-0 sm:min-w-60 sm:max-w-[calc(100vw-2rem)]"
      >
        {filterable && (
          <input
            ref={filter}
            type="search"
            aria-label={`Find a ${control.picker.toLowerCase()}`}
            placeholder={`Find a ${control.picker.toLowerCase()}`}
            aria-controls={listId}
            aria-activedescendant={open && shown.includes(active) ? optionId(active) : undefined}
            value={query}
            onChange={(event) => onFilter(event.target.value)}
            onKeyDown={moveOrChoose}
            onBlur={onBlur}
            data-testid={`bar-filter-${control.sets}`}
            className="mb-1 min-h-control shrink-0 rounded-control border border-border-control bg-surface px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-focus"
          />
        )}
        {filterable && shown.length === 0 && (
          <p className="px-2 py-2 text-sm text-ink-muted" data-testid={`bar-no-match-${control.sets}`}>
            No {control.picker.toLowerCase()} matches
          </p>
        )}
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          // A press on an option must not take focus from the picker first.
          onMouseDown={(event) => event.preventDefault()}
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid={`bar-options-${control.sets}`}
        >
          {shown.map((index) => {
            const option = options[index]
            return (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={index === currentIndex}
              onClick={() => choose(index)}
              onMouseEnter={() => setActive(index)}
              className={cx(
                'flex min-h-control cursor-pointer items-center gap-2 rounded-control px-2 text-sm text-ink',
                index === active && 'bg-action-tint',
                index === currentIndex && 'font-semibold',
              )}
            >
              <span className="flex w-4 shrink-0 justify-center text-action" aria-hidden>
                {index === currentIndex && <Check size={14} />}
              </span>
              <span className="truncate">{option.label}</span>
            </li>
          )})}
        </ul>
      </div>
    </div>
  )
}
