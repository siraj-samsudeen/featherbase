import { RecordPagesProvider } from '@featherbase/shop-floor'
import { createElement } from 'react'
import { AdjustmentsPage, ClosePage, ClosesPage } from './ClosePages'
import { BudgetsPage, VersionPage } from './BudgetsPages'
import { FollowUpsPage, RecordPage } from './OtherPages'
import { PlPage } from './PlPage'
import { AccountsPage, AreasPage, LinesPage, RulePage, RulesPage } from './RulesPages'
import { to, useRoute } from './route'
import { pageFor } from './ui'

const NAV = [
  { page: 'pl', label: 'P&L' },
  { page: 'budgets', label: 'Budgets' },
  { page: 'closes', label: 'Monthly Close' },
  { page: 'adjustments', label: 'Adjustments' },
  { page: 'accounts', label: 'Accounts' },
  { page: 'lines', label: 'P&L Lines' },
  { page: 'rules', label: 'Allocation Rules' },
  { page: 'areas', label: 'Store Areas' },
  { page: 'followups', label: 'Follow-ups' },
]
/** The sidebar item a page belongs under. */
const UNDER: Record<string, string> = { version: 'budgets', close: 'closes', rule: 'rules' }
const RECORD_UNDER: Record<string, string> = { budget_version: 'budgets', pl_budget: 'budgets', sales_budget: 'budgets', budget_store_plan: 'budgets', monthly_close: 'closes', monthly_close_adjustment: 'adjustments',
  gl_account: 'accounts', gl_account_split: 'accounts', pl_line: 'lines', allocation_rule: 'rules', allocation_rule_segment: 'rules', allocation_rule_store: 'rules', store_area: 'areas' }

export function BudgetsApp() {
  const route = useRoute()
  const current = route.page === 'record' ? RECORD_UNDER[route.id.split('/')[0]] : UNDER[route.page] ?? route.page
  // Featherbase's shared sidebar, as every app uses (app-navigation spec).
  return <RecordPagesProvider pageFor={pageFor}>
    <div className="budgets-shell">
      {createElement('featherbase-sidebar', { className: 'budgets-nav', 'aria-label': 'Budgets pages' },
        NAV.map(item => <a key={item.page} href={to(item.page)} aria-current={current === item.page ? 'page' : undefined}>{item.label}</a>))}
      <main className="budgets-main">
        {route.page === 'pl' && <PlPage />}
        {route.page === 'budgets' && <BudgetsPage />}
        {route.page === 'version' && <VersionPage key={route.id} id={route.id} />}
        {route.page === 'closes' && <ClosesPage />}
        {route.page === 'close' && <ClosePage key={route.id} id={route.id} />}
        {route.page === 'adjustments' && <AdjustmentsPage />}
        {route.page === 'accounts' && <AccountsPage />}
        {route.page === 'lines' && <LinesPage />}
        {route.page === 'rules' && <RulesPage />}
        {route.page === 'rule' && <RulePage key={route.id} id={route.id} />}
        {route.page === 'areas' && <AreasPage />}
        {route.page === 'followups' && <FollowUpsPage />}
        {route.page === 'record' && <RecordPage key={route.id} path={route.id} />}
      </main>
    </div>
  </RecordPagesProvider>
}
