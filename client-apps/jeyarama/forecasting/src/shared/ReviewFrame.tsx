// The managers' page frame (the agreed prototypes): the page header (with the page's own control on its right, such
// as RB's Region toggle), the search box and its scope, then ONE row of tabs, one per view, Help last (owner,
// 27-Nov-2026: "i just want tabs for diff views"). Each view is a layout and what it opens on; a page lists its own.
// The view picked is kept in the address (?tab=), so a link or a reload opens it. Hidden views keep their drafts.
import { useId, useRef, useState, type ReactNode } from 'react'
import { Notice, PageHeader } from '@featherbase/shop-floor'
import type { Line } from './model'
import { ScopeSearch, type ScopeState } from './ScopeSearch'
import type { Kind } from './scope'

export interface View { id: string; label: string; content: ReactNode }
/** A tab that opens another page: the store's or the region's Days and Needs Your Attention, before Help. */
export interface ViewLink { id: string; label: string; href: string }

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

/** One underlined row of tabs (.fr-tabs, the Team Leader page's too); ← → Home End move along it, as Shop Floor's
 *  ContentTabs do. */
function ViewTabs({ views, value, onChange, links = [] }: { views: View[]; value: string; onChange: (id: string) => void; links?: ViewLink[] }) {
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  // tabs that open other pages go before Help (after the last view when there is none)
  const linkTabs = links.map(l => (
    <button key={`link-${l.id}`} type="button" role="tab" aria-selected={false} tabIndex={-1} data-href={l.href}
      onClick={() => { history.pushState(null, '', l.href); window.dispatchEvent(new PopStateEvent('popstate')) }}>{l.label}</button>))
  return <>
    <nav className="fr-tabs" role="tablist" aria-label="Views" data-testid="view-tabs">
      {views.map((v, i) => (
        <button key={v.id} ref={el => { buttons.current[i] = el }} type="button" role="tab" id={`${id}-tab-${v.id}`} aria-controls={`${id}-panel-${v.id}`}
          aria-selected={value === v.id} tabIndex={value === v.id ? 0 : -1} onClick={() => onChange(v.id)}
          onKeyDown={e => {
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? views.length - 1 : e.key === 'ArrowRight' ? (i + 1) % views.length
              : e.key === 'ArrowLeft' ? (i - 1 + views.length) % views.length : null
            if (next === null) return
            e.preventDefault(); onChange(views[next].id); buttons.current[next]?.focus()
          }}>{v.label}</button>)).flatMap((b, i) => (i !== views.length - 1 ? [b] : views[i].id === 'help' ? [...linkTabs, b] : [b, ...linkTabs]))}
    </nav>
    {views.map(v => (
      <div key={v.id} id={`${id}-panel-${v.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${v.id}`} hidden={value !== v.id} className="fr-tabpanel min-w-0">{v.content}</div>))}
  </>
}

export function ReviewFrame({ title, status, actions, all, scope, kinds, views, view, onView, testId, unsaved = false, links }: {
  title: string; status: string; actions?: ReactNode
  /** On a real Run the managers' approvals, changes and questions are not saved yet (the hook is a stand-in until
   *  they write the tables): say so rather than show "You approved" and lose it on reload. */
  unsaved?: boolean
  /** Every line the page may show, for the search box; `scope` is the page's useScope. */
  all: Line[]; scope: ScopeState; kinds?: Kind[]
  /** The page's views in order, Help last; `view` is the one shown. */
  views: View[]; view: string; onView: (id: string) => void
  testId?: string
  /** Tabs that open other pages, before Help. */
  links?: ViewLink[]
}) {
  return (
    <div className="fr flex flex-col" data-testid={testId}>
      <PageHeader title={title} status={status} actions={actions} />
      {unsaved && <Notice tone="caution" className="mb-3">Approvals, changes and questions on this page are not saved yet: they last until you reload. Team Leaders' proposals do not show here yet.</Notice>}
      <ScopeSearch all={all} state={scope} kinds={kinds} />
      <ViewTabs views={views} value={view} onChange={onView} links={links} />
    </div>
  )
}
