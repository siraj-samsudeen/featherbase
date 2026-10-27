import { useId, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { api } from '../lib/api'
import { cx } from './ui'
import { Check, ChevronDown } from './ui/icons'

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
}

export function BarControls({ app }: { app: string }) {
  const bar = useQuery({
    queryKey: ['app_bar', app],
    queryFn: () => api.get<{ controls: BarControl[] }>(`/api/app_bar/${encodeURIComponent(app)}`),
    retry: false,
  })
  const controls = (bar.data?.controls ?? []).filter((control) => control.options.length > 0)
  if (controls.length === 0) return null
  return (
    <div className="flex min-w-0 shrink items-center gap-2" data-testid="bar-controls">
      {controls.map((control) => (
        <BarPicker key={control.sets} control={control} />
      ))}
    </div>
  )
}

/** The value a key holds in the address, read and written through the
 *  router, so a choice is a history entry and never a full reload. */
function useAddressValue(key: string): [string | null, (value: string) => void] {
  const router = useRouter()
  const location = useRouterState({ select: (state) => state.location })
  const value = new URLSearchParams(location.searchStr).get(key)
  function set(next: string) {
    const params = new URLSearchParams(location.searchStr)
    params.set(key, next)
    router.history.push(`${location.pathname}?${params.toString()}${location.hash ? `#${location.hash}` : ''}`)
  }
  return [value, set]
}

const LABEL = 'text-sm text-ink-muted max-sm:sr-only'

function BarPicker({ control }: { control: BarControl }) {
  const { options } = control
  const labelId = useId()
  const listId = useId()
  const [value, setValue] = useAddressValue(control.sets)
  const currentIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const current = options[currentIndex]
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(currentIndex)
  const optionId = (index: number) => `${listId}-${index}`

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
    setOpen(true)
  }
  function choose(index: number) {
    setOpen(false)
    const option = options[index]
    if (option && option.value !== value) setValue(option.value)
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        show()
      }
      return
    }
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, active + 1),
      ArrowUp: () => Math.max(0, active - 1),
      Home: () => 0,
      End: () => last,
      PageDown: () => last,
      PageUp: () => 0,
    }
    if (moves[event.key]) {
      event.preventDefault()
      setActive(moves[event.key]())
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="relative flex min-w-0 items-center gap-2" data-testid={`bar-control-${control.sets}`}>
      <span id={labelId} className={LABEL}>
        {control.picker}
      </span>
      <button
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
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
      <ul
        id={listId}
        role="listbox"
        aria-labelledby={labelId}
        hidden={!open}
        // A press on an option must not take focus from the picker first.
        onMouseDown={(event) => event.preventDefault()}
        className="absolute left-0 top-full z-30 mt-1 min-w-60 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-lg max-sm:left-auto max-sm:right-0"
        data-testid={`bar-options-${control.sets}`}
      >
        {options.map((option, index) => (
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
        ))}
      </ul>
    </div>
  )
}
