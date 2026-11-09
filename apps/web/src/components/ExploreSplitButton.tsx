import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useStepOptions, type Step } from '../lib/explore-steps'
import { buttonClasses, cardClasses } from '@featherbase/shop-floor'

// Option B of the Explore entry-point exploration: a split button on the
// list header. The main face opens the cross-filter Explore rooted at this
// table; the chevron reveals this table's chainable dependents — the SAME
// options Explore's own step pickers offer (the shared explore-steps seam)
// — to deep-link a pre-built chain. Selection is capped at two, the pane
// limit, and kept in CHECK order because chain order is pane order. No
// per-option row counts on purpose: each would cost a query.
export function ExploreSplitButton({ table }: { table: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { options } = useStepOptions(open ? table : undefined)
  const [picked, setPicked] = useState<string[]>([])
  const togglePick = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key].slice(0, 2)))
  const openExplore = (chain: Step[]) =>
    navigate({
      to: '/featherbase/admin/explore',
      search: {
        root: table,
        chain: chain.length ? JSON.stringify(chain) : undefined,
        select: undefined,
      },
    })
  return (
    <div className="relative">
      <div className="flex">
        <button
          type="button"
          onClick={() => void openExplore([])}
          className={buttonClasses({ className: 'rounded-r-none' })}
          data-testid="open-explore"
        >
          Explore
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Explore with a chain"
          aria-expanded={open}
          className={buttonClasses({ className: 'rounded-l-none border-l-0 pointer-fine:px-1.5 pointer-coarse:min-w-control' })}
          data-testid="explore-split-toggle"
        >
          <span aria-hidden data-chevron className="inline-block">▾</span>
        </button>
      </div>
      {open && (
        <div className={cardClasses('absolute right-0 z-10 mt-1 w-64 p-2')} data-testid="explore-split-panel">
          <div className="px-2 pb-1 text-xs font-semibold text-ink-subtle">
            Chain into
          </div>
          {options.map((o) => {
            const checked = picked.includes(o.key)
            return (
              <label
                key={o.key}
                className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-subtle ${
                  !checked && picked.length >= 2 ? 'opacity-40' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && picked.length >= 2}
                  data-testid="explore-split-option"
                  onChange={() => togglePick(o.key)}
                />
                {o.label}
              </label>
            )
          })}
          {!options.length && (
            <p className="px-2 py-1 text-sm text-ink-subtle">No dependents</p>
          )}
          <div className="mt-1 border-t border-border px-2 pt-2">
            <button
              type="button"
              disabled={!picked.length}
              onClick={() =>
                void openExplore(
                  picked
                    .map((k) => options.find((o) => o.key === k)?.step)
                    .filter((s): s is Step => Boolean(s)),
                )
              }
              className={buttonClasses({ variant: 'primary', className: 'w-full !py-1 text-xs' })}
              data-testid="explore-split-open"
            >
              Open
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
