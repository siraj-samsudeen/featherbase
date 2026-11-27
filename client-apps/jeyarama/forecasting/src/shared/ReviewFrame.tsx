// The managers' page frame (the agreed prototypes): the page header (with the page's own control on its right, such
// as RB's Region toggle), the search box and its scope, then ONE row of tabs, one per view, Help last (owner,
// 27-Nov-2026: "i just want tabs for diff views"). Each view is a layout and what it opens on; a page lists its own.
// The view picked is kept in the address (?tab=), so a link or a reload opens it. Hidden views keep their drafts.
import { useId, useRef, useState, type ReactNode } from 'react'
import { PageHeader } from '@featherbase/shop-floor'
import type { Line } from './model'
import { ScopeSearch, type ScopeState } from './ScopeSearch'
import type { Kind } from './scope'

export interface View { id: string; label: string; content: ReactNode }

/** The view in the address (?tab=), or the page's first. */
export function useView(ids: string[]) {
  const read = () => {
    const id = new URLSearchParams(window.location.search).get('tab')
    return id && ids.includes(id) ? id : ids[0]
  }
  const [view, setView] = useState(read)
  const choose = (id: string) => {
    const q = new URLSearchParams(window.location.search)
    if (id === ids[0]) q.delete('tab'); else q.set('tab', id)
    history.replaceState(null, '', `?${q}`)
    setView(id)
  }
  return [view, choose] as const
}

/** One underlined row of tabs; ← → Home End move along it, as Shop Floor's ContentTabs do. */
function ViewTabs({ views, value, onChange }: { views: View[]; value: string; onChange: (id: string) => void }) {
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  return <>
    <nav className="fr-layouts" role="tablist" aria-label="Views" data-testid="view-tabs">
      {views.map((v, i) => (
        <button key={v.id} ref={el => { buttons.current[i] = el }} type="button" role="tab" id={`${id}-tab-${v.id}`} aria-controls={`${id}-panel-${v.id}`}
          aria-selected={value === v.id} tabIndex={value === v.id ? 0 : -1} onClick={() => onChange(v.id)}
          onKeyDown={e => {
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? views.length - 1 : e.key === 'ArrowRight' ? (i + 1) % views.length
              : e.key === 'ArrowLeft' ? (i - 1 + views.length) % views.length : null
            if (next === null) return
            e.preventDefault(); onChange(views[next].id); buttons.current[next]?.focus()
          }}>{v.label}</button>))}
    </nav>
    {views.map(v => (
      <div key={v.id} id={`${id}-panel-${v.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${v.id}`} hidden={value !== v.id} className="fr-viewpanel">{v.content}</div>))}
  </>
}

export function ReviewFrame({ title, status, actions, all, scope, kinds, views, view, onView, testId }: {
  title: string; status: string; actions?: ReactNode
  /** Every line the page may show, for the search box; `scope` is the page's useScope. */
  all: Line[]; scope: ScopeState; kinds?: Kind[]
  /** The page's views in order, Help last; `view` is the one shown. */
  views: View[]; view: string; onView: (id: string) => void
  testId?: string
}) {
  return (
    <div className="fr flex flex-col" data-testid={testId}>
      <PageHeader title={title} status={status} actions={actions} />
      <ScopeSearch all={all} state={scope} kinds={kinds} />
      <ViewTabs views={views} value={view} onChange={onView} />
    </div>
  )
}
