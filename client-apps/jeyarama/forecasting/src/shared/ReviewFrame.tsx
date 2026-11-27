// The managers' page frame (the agreed prototypes): the page header, the search box and its scope, the Layout
// strip, then the layout's own tabs. Layouts are permanent and user-facing (Siraj, 27-Nov-2026: let people use the
// one they like): one underlined strip under the search, the default first; each layout's tabs are Shop Floor's
// ContentTabs below it, so the two levels never read as one row. The layout picked is kept in the address
// (?layout=), so a link or a reload opens it.
import { useState, type ReactNode } from 'react'
import { ContentTabs, PageHeader } from '@featherbase/shop-floor'
import type { Line } from './model'
import { ScopeSearch, type ScopeState } from './ScopeSearch'
import type { Kind } from './scope'

export interface Layout { id: string; label: string }

/** The layout in the address, or the page's first (its default). */
export function useLayout(layouts: Layout[]) {
  const read = () => {
    const id = new URLSearchParams(window.location.search).get('layout')
    return layouts.some(l => l.id === id) ? id! : layouts[0].id
  }
  const [layout, setLayout] = useState(read)
  const choose = (id: string) => {
    const q = new URLSearchParams(window.location.search)
    if (id === layouts[0].id) q.delete('layout'); else q.set('layout', id)
    history.replaceState(null, '', `?${q}`)
    setLayout(id)
  }
  return [layout, choose] as const
}

export function LayoutTabs({ layouts, value, onChange }: { layouts: Layout[]; value: string; onChange: (id: string) => void }) {
  return (
    <nav className="fr-layouts" role="tablist" aria-label="Layouts" data-testid="layout-tabs">
      <span className="fr-layouts-label">Layout</span>
      {layouts.map(l => <button key={l.id} type="button" role="tab" aria-selected={value === l.id} onClick={() => onChange(l.id)}>{l.label}</button>)}
    </nav>
  )
}

export function ReviewFrame({ title, status, actions, all, scope, kinds, layouts, layout, onLayout, tabs, tab, onTab, testId }: {
  title: string; status: string; actions?: ReactNode
  /** Every line the page may show, for the search box; `scope` is the page's useScope. */
  all: Line[]; scope: ScopeState; kinds?: Kind[]
  layouts: Layout[]; layout: string; onLayout: (id: string) => void
  tabs: { id: string; label: string; content: ReactNode }[]; tab: string; onTab: (id: string) => void
  testId?: string
}) {
  return (
    <div className="fr flex flex-col" data-testid={testId}>
      <PageHeader title={title} status={status} actions={actions} />
      <ScopeSearch all={all} state={scope} kinds={kinds} />
      <LayoutTabs layouts={layouts} value={layout} onChange={onLayout} />
      <ContentTabs className="mt-4" label="Review sections" value={tab} onChange={onTab} tabs={tabs} />
    </div>
  )
}
