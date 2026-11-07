import { createElement, useEffect, useState } from 'react'
import { AssetPage } from './AssetPage'
import { AssetsList } from './AssetsList'
import { CountPage, CountsPage, ReviewPage } from './Counts'
import { JobsBoard } from './JobsBoard'
import { LabelSheet } from './LabelSheet'

type Route = { page: 'jobs' } | { page: 'assets' } | { page: 'labels' } | { page: 'counts' }
  | { page: 'asset'; id: string } | { page: 'count'; id: string } | { page: 'review'; id: string }

function readRoute(): Route {
  const hash = new URLSearchParams(location.hash.slice(1))
  for (const page of ['asset', 'count', 'review'] as const) {
    const id = hash.get(page)
    if (id) return { page, id }
  }
  if (hash.has('assets')) return { page: 'assets' }
  if (hash.has('labels')) return { page: 'labels' }
  if (hash.has('counts')) return { page: 'counts' }
  return { page: 'jobs' }
}

const NAV: { page: Route['page']; label: string; hash: string }[] = [
  { page: 'jobs', label: 'Repair jobs', hash: '#jobs' },
  { page: 'assets', label: 'Assets', hash: '#assets' },
  { page: 'counts', label: 'Counts', hash: '#counts' },
  { page: 'labels', label: 'QR labels', hash: '#labels' },
]

export function AssetsApp({ roles }: { roles: string[] }) {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const change = () => setRoute(readRoute())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const current = route.page === 'count' || route.page === 'review' ? 'counts' : route.page

  // Featherbase's shared sidebar, as every app uses (app-navigation spec).
  return <div className="assets-shell">
    {createElement('featherbase-sidebar', { className: 'assets-nav', 'aria-label': 'Assets pages' }, <>
      {NAV.map(item => <a key={item.page} href={item.hash} aria-current={current === item.page ? 'page' : undefined}>{item.label}</a>)}
      <a className="assets-nav-admin" href="/featherbase/admin/table/equipment.asset">Edit the register in Featherbase ↗</a>
    </>)}
    <main className="assets-main">
      {route.page === 'jobs' && <JobsBoard roles={roles} />}
      {route.page === 'assets' && <AssetsList />}
      {route.page === 'labels' && <LabelSheet />}
      {route.page === 'counts' && <CountsPage roles={roles} />}
      {route.page === 'count' && <CountPage key={route.id} id={route.id} />}
      {route.page === 'review' && <ReviewPage key={route.id} id={route.id} />}
      {route.page === 'asset' && <AssetPage key={route.id} id={route.id} />}
    </main>
  </div>
}
