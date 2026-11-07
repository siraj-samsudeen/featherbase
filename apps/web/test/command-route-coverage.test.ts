import { expect, it } from 'vitest'
import { routeTree } from '../src/router'
import { test } from './pg-test'

// Full route families, not just first segments: adding a setup sub-page or
// another named-resource page must make an explicit discovery decision.
// The descriptions identify its real provider or why it needs context.
const COVERAGE: Record<string, string> = {
  '/': 'sign-in landing redirect',
  '/featherbase': 'sign-in landing redirect',
  '/featherbase/login': 'authentication entry flow',
  '/featherbase/reset-password': 'credential recovery entry flow',
  '/featherbase/oauth-callback': 'one-time authentication callback',
  '/featherbase/form/$route': 'published readable Web Forms',
  '/featherbase/portal/$table': 'alternate rendering of a readable Table',
  '/featherbase/portal/$table/$name': 'requires an existing row',
  '/featherbase/sales-target': 'report capability',
  '/featherbase/account': 'account layout',
  '/featherbase/account/sign-in-methods': 'own account page',
  '/featherbase/account/approvals': 'own account page (#627)',
  '/featherbase/account/access/$person': 'a person\'s own access page, from the account menu or their Person row (#628)',
  '/featherbase/print/$table/$name': 'requires an existing row',
  '/featherbase/admin': 'Admin layout and existing home command',
  '/featherbase/admin/': 'visible Home Page redirect',
  '/featherbase/admin/new-table': 'existing New Table command',
  '/featherbase/admin/import': 'manager page catalogue',
  '/featherbase/admin/imports': 'manager page catalogue',
  '/featherbase/admin/table/$table/columns': 'requires a selected Table',
  '/featherbase/admin/table/$table/merge': 'requires a selected Table',
  '/featherbase/admin/table/$table': 'complete readable Table metadata inventory',
  '/featherbase/admin/table/$table/row/$name': 'record search',
  '/featherbase/admin/table/$table/new': 'contextual new-row action',
  '/featherbase/admin/table/$table/view/report': 'alternative view of a selected Table',
  '/featherbase/admin/table/$table/view/kanban': 'alternative view of a selected Table',
  '/featherbase/admin/table/$table/view/calendar': 'alternative view of a selected Table',
  '/featherbase/admin/table/$table/view/gantt': 'alternative view of a selected Table',
  '/featherbase/admin/table/$table/view/checklist': 'alternative view of a selected Table',
  '/featherbase/admin/script-report/$name': 'readable registered script reports',
  '/featherbase/admin/jobs': 'manager page catalogue',
  '/featherbase/admin/access-tokens': 'page catalogue',
  '/featherbase/admin/find-person': 'page catalogue plus required Table reads',
  '/featherbase/admin/waiting-for-access': 'manager page catalogue',
  '/featherbase/admin/instance-health': 'manager page catalogue',
  '/featherbase/admin/apps': 'manager page catalogue',
  '/featherbase/admin/glossary': 'page catalogue',
  '/featherbase/admin/setup': 'manager page catalogue',
  '/featherbase/admin/setup/person': 'Administrator-only page catalogue',
  '/featherbase/admin/setup/people': 'redirects to setup/person',
  '/featherbase/admin/home/$name': 'visible Home Pages',
  '/featherbase/admin/all-tables': 'page catalogue',
  '/featherbase/admin/source/$name': 'manager readable Data Sources',
  '/featherbase/admin/source/$name/copy': 'requires a selected warehouse database, schema and table',
  '/featherbase/admin/dashboard/$name': 'scoped readable Dashboards',
  '/featherbase/admin/table/$table/naming': 'requires a selected Table',
  '/featherbase/admin/table/$table/permissions': 'requires a selected Table',
  '/featherbase/admin/explore': 'page catalogue',
}

it('#737 every actual router family has a destination provider or a contextual exclusion', () => {
  interface Route { options: { path?: string }; children?: Route[] }
  const paths: string[] = []
  function visit(route: Route, parent: string) {
    const own = route.options.path
    const path = own === undefined ? parent : own.startsWith('/') ? own === '/' && parent ? `${parent}/` : own : `${parent}/${own}`
    if (own !== undefined) paths.push(path)
    for (const child of Object.values(route.children ?? [])) visit(child, path)
  }
  visit(routeTree as unknown as Route, '')
  expect(paths.length).toBeGreaterThan(40)
  expect(paths.sort()).toEqual(Object.keys(COVERAGE).sort())
})

test('#737 every standalone Admin route is actually supplied to Cmd K', async ({ admin }) => {
  type Route = { options: { path?: string }; children?: Route[] }
  const roots = routeTree.children as unknown as Route[]
  const parent = roots.find((r) => r.options.path === '/featherbase/admin')!
  const standalone = Object.values(parent.children ?? [])
    .map((r) => r.options.path)
    .filter((path): path is string => Boolean(path && path !== '/' && path !== 'new-table' && path !== 'setup/people' && !path.includes('$')))
  const inventory = await admin.get<{ pages: { href: string }[] }>('/api/command_destinations')
  expect(standalone.length).toBeGreaterThan(10)
  for (const path of standalone)
    expect(inventory.pages.map((p) => p.href)).toContain(`/featherbase/admin/${path}`)
})
