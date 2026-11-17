import { LIST_LAYOUTS, type ListLayout } from 'shared'
import { PanelLeft, PanelRight, Rows3, cx, type LucideIcon } from '@featherbase/shop-floor'

// #1259 (Siraj, 17-Nov; switch mockup Option 1): three icon buttons right after
// a list's title. The chosen view is a white tile on a soft fill; each button
// is named by its tooltip and its accessible name.

const LAYOUT: Record<ListLayout, { label: string; Icon: LucideIcon }> = {
  table: { label: 'Table', Icon: Rows3 },
  split: { label: 'List And Record', Icon: PanelLeft },
  panel: { label: 'Table With Panel', Icon: PanelRight },
}

export function layoutLabel(layout: ListLayout): string {
  return LAYOUT[layout].label
}

export function LayoutSwitch({ value, onChange }: { value: ListLayout; onChange: (layout: ListLayout) => void }) {
  return (
    <div role="group" aria-label="Views" data-testid="layout-switch" className="inline-flex items-center gap-0.5 rounded-md bg-canvas p-0.5">
      {LIST_LAYOUTS.map((layout) => {
        const { label, Icon } = LAYOUT[layout]
        const on = layout === value
        return (
          <button
            key={layout}
            type="button"
            aria-label={label}
            aria-pressed={on}
            title={label}
            data-testid={`layout-${layout}`}
            onClick={() => { if (!on) onChange(layout) }}
            className={cx(
              'grid h-7 w-8 place-items-center rounded focus-visible:outline-2 focus-visible:outline-focus',
              on ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            <Icon aria-hidden size={15} />
          </button>
        )
      })}
    </div>
  )
}
