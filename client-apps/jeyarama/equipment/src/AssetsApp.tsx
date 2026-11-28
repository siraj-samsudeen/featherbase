import { createElement, useEffect, useState } from 'react'
import { useSidebarRows, type SidebarItem } from '@featherbase/shop-floor/sidebar'
import { AssetPage } from './AssetPage'
import { AssetsList } from './AssetsList'
import { CountPage, CountsPage, ReviewPage } from './Counts'
import { CustodyPage } from './Custody'
import { JobsBoard } from './JobsBoard'
import { ExceptionsPage, SapPage } from './Finance'
import { SetupPage } from './Setup'
import { TagRoute, TagsPage } from './Tagging'
import { TransferPage, TransfersPage } from './Transfers'

type Route = { page: 'jobs' } | { page: 'assets' } | { page: 'labels' } | { page: 'counts' } | { page: 'custody' } | { page: 'transfers' } | { page: 'setup' } | { page: 'sap' } | { page: 'exceptions' }
  | { page: 'tag'; id: string }
  | { page: 'asset'; id: string } | { page: 'count'; id: string } | { page: 'review'; id: string } | { page: 'transfer'; id: string }

function readRoute(): Route {
  const hash = new URLSearchParams(location.hash.slice(1))
  for (const page of ['asset', 'count', 'review', 'transfer', 'tag'] as const) {
    const id = hash.get(page)
    if (id) return { page, id }
  }
  if (hash.has('assets')) return { page: 'assets' }
  if (hash.has('labels')) return { page: 'labels' }
  if (hash.has('counts')) return { page: 'counts' }
  if (hash.has('custody')) return { page: 'custody' }
  if (hash.has('transfers')) return { page: 'transfers' }
  if (hash.has('setup')) return { page: 'setup' }
  if (hash.has('sap')) return { page: 'sap' }
  if (hash.has('exceptions')) return { page: 'exceptions' }
  return { page: 'jobs' }
}

// #1385 (slice 4): the pages everyone here opens are declared in featherbase.json (`sidebar`); the finance
// pages, which only some roles open, are given at run time. The shared sidebar draws both.
const FINANCE_NAV: (SidebarItem & { roles: string[] })[] = [
  { label: 'SAP Matching', address: '#sap', icon: 'link', roles: ['Assets Accountant'] },
  { label: 'Exceptions', address: '#exceptions', icon: 'warning', roles: ['Assets Accountant', 'Assets Finance Controller', 'Assets Manager', 'System Manager'] },
]

export function AssetsApp({ roles }: { roles: string[] }) {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const change = () => setRoute(readRoute())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const current = route.page === 'count' || route.page === 'review' ? 'counts' : route.page === 'transfer' ? 'transfers' : route.page

  useSidebarRows({
    current: `#${current}`,
    sections: [{ id: 'finance', items: FINANCE_NAV.filter(item => item.roles.some(role => roles.includes(role))).map(({ roles: _, ...item }) => item) }],
  })

  // Featherbase's shared sidebar, as every app uses (app-navigation spec): placed here, drawn by the platform.
  return <div className="assets-shell">
    {createElement('featherbase-sidebar', { className: 'assets-nav', 'aria-label': 'Assets pages' })}
    <main className="assets-main">
      {route.page === 'jobs' && <JobsBoard roles={roles} />}
      {route.page === 'assets' && <AssetsList />}
      {route.page === 'labels' && <TagsPage roles={roles} />}
      {route.page === 'setup' && <SetupPage roles={roles} />}
      {route.page === 'sap' && <SapPage />}
      {route.page === 'exceptions' && <ExceptionsPage roles={roles} />}
      {route.page === 'tag' && <TagRoute key={route.id} tag={route.id} />}
      {route.page === 'counts' && <CountsPage roles={roles} />}
      {route.page === 'count' && <CountPage key={route.id} id={route.id} />}
      {route.page === 'review' && <ReviewPage key={route.id} id={route.id} />}
      {route.page === 'custody' && <CustodyPage roles={roles} />}
      {route.page === 'transfers' && <TransfersPage roles={roles} />}
      {route.page === 'transfer' && <TransferPage key={route.id} id={route.id} roles={roles} />}
      {route.page === 'asset' && <AssetPage key={route.id} id={route.id} />}
    </main>
  </div>
}
