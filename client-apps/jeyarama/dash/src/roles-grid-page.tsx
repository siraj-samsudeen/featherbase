// #1340: the business roles live in Featherbase's own pages; Dash keeps #1282's grid (roles × permissions, roles ×
// reports), which Featherbase's Open as grid opens. The rules are the server's (change_permissions, change_report_grants).
import { useState } from 'react'
import { Card, EmptyState, Segmented, buttonClasses } from '@featherbase/shop-floor'
import { Loading, Shell } from './sections-page'
import { PermissionsGrid, ReportsGrid, type GivenThing, type GridRole } from './roles-grid'
import { FEATHERBASE_ROLES, Failed, explainAddress, useRead } from './roles-shared'

interface RolesAnswer {
  roles: GridRole[]
  /** #1282 F1–F6: whether the permissions grid steps for this caller, and whether the reports grid does. */
  may_change: boolean
  may_give_reports: boolean
  report_catalog: GivenThing[]
}

type GridView = 'permissions' | 'reports'

export function RolesGridPage() {
  const { answer, failed, load } = useRead<RolesAnswer>('business_roles', {})
  const asked = new URLSearchParams(window.location.search).get('grid') === 'reports' ? 'reports' : 'permissions'
  const [view, setView] = useState<GridView>(asked)
  const [waiting, setWaiting] = useState(0)
  // Leaving one grid with changes waiting asks first.
  const show = (next: GridView) => {
    if (next !== view && waiting > 0 && !window.confirm(`Leave the grid? ${waiting === 1 ? 'Your change' : `Your ${waiting} changes`} will not be saved.`)) return
    setView(next)
  }
  return (
    <Shell current="roles-grid" testid="roles-grid-page" title="Business Roles Grid" wide>
      <div className="flex flex-wrap items-center gap-3">
        {answer && answer.roles.length > 0 && (
          <Segmented label="Show the grid of" value={view} onChange={show}
            options={[{ value: 'permissions', label: 'Permissions' }, { value: 'reports', label: 'Reports' }]} />
        )}
        <span className="flex-1" />
        <a href={FEATHERBASE_ROLES} className={buttonClasses()} data-testid="roles-in-featherbase">Business Roles in Featherbase ↗</a>
      </div>
      {!answer && !failed && <Loading />}
      {failed && <Failed message={failed} onRetry={load} />}
      {answer && answer.roles.length === 0 && (
        <Card data-testid="no-roles"><EmptyState title="No business roles yet" body="Add the starting roles from Record actions on Business Roles in Featherbase." /></Card>
      )}
      {answer && answer.roles.length > 0 && view === 'permissions' && (
        <Card data-testid="roles-grid-card">
          <PermissionsGrid roles={answer.roles} mayChange={answer.may_change} onSaved={load} onWaiting={setWaiting} personHref={explainAddress} />
        </Card>
      )}
      {answer && answer.roles.length > 0 && view === 'reports' && (
        <Card data-testid="reports-grid-card">
          <ReportsGrid roles={answer.roles} catalog={answer.report_catalog} mayChange={answer.may_give_reports} onSaved={load} onWaiting={setWaiting} personHref={explainAddress} />
        </Card>
      )}
    </Shell>
  )
}
