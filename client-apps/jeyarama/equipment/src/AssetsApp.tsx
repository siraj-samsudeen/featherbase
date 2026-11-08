import { createElement, useEffect, useState } from 'react'
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

const NAV: { page: Route['page']; label: string; hash: string }[] = [
  { page: 'jobs', label: 'Repair jobs', hash: '#jobs' },
  { page: 'assets', label: 'Assets', hash: '#assets' },
  { page: 'counts', label: 'Counts', hash: '#counts' },
  { page: 'custody', label: 'Custody', hash: '#custody' },
  { page: 'transfers', label: 'Transfers', hash: '#transfers' },
  { page: 'labels', label: 'Tags and labels', hash: '#labels' },
  { page: 'setup', label: 'Pilot setup', hash: '#setup' },
]
const FINANCE_NAV: { page: Route['page']; label: string; hash: string; roles: string[] }[] = [
  { page: 'sap', label: 'SAP matching', hash: '#sap', roles: ['Assets Accountant'] },
  { page: 'exceptions', label: 'Exceptions', hash: '#exceptions', roles: ['Assets Accountant', 'Assets Finance Controller', 'Assets Manager', 'System Manager'] },
]

export function AssetsApp({ roles }: { roles: string[] }) {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const change = () => setRoute(readRoute())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const current = route.page === 'count' || route.page === 'review' ? 'counts' : route.page === 'transfer' ? 'transfers' : route.page

  // Featherbase's shared sidebar, as every app uses (app-navigation spec).
  return <div className="assets-shell">
    {createElement('featherbase-sidebar', { className: 'assets-nav', 'aria-label': 'Assets pages' }, <>
      {NAV.map(item => <a key={item.page} href={item.hash} aria-current={current === item.page ? 'page' : undefined}>{item.label}</a>)}
      {FINANCE_NAV.filter(item => item.roles.some(role => roles.includes(role))).map(item => <a key={item.page} href={item.hash} aria-current={current === item.page ? 'page' : undefined}>{item.label}</a>)}
      <a className="assets-nav-admin" href="/featherbase/admin/table/equipment.asset">Edit the register in Featherbase ↗</a>
    </>)}
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
