import { createElement } from 'react'

export function BudgetsApp({ roles }: { roles: string[] }) {
  void roles
  return <div className="budgets-shell">
    {createElement('featherbase-sidebar', { className: 'budgets-nav', 'aria-label': 'Budgets pages' }, <a href="#budgets" aria-current="page">Budgets</a>)}
    <main className="budgets-main"><h1>Budgets</h1></main>
  </div>
}
