import { THEMES, THEME_CHANGE_EVENT, paintTheme, type Theme } from '@featherbase/shop-floor/theme'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BudgetsApp } from './BudgetsApp'
import { ApiError, api } from './api'
import './style.css'

paintTheme('device')
window.addEventListener(THEME_CHANGE_EVENT, (event) => {
  const theme = (event as CustomEvent<{ theme: 'light' | 'dark' }>).detail?.theme
  if (theme === 'light' || theme === 'dark') paintTheme(theme)
})

const root = createRoot(document.getElementById('root')!)
async function boot() {
  try {
    const user = await api.get<{ row_id: string; theme: Theme; roles: string[] }>('/api/whoami')
    paintTheme(THEMES.includes(user.theme) ? user.theme : 'device')
    localStorage.setItem('fc_user', JSON.stringify(user))
    root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } } })}>
      <BudgetsApp roles={user.roles ?? []} />
    </QueryClientProvider>)
  } catch (error) {
    // Signed out: come back to the same page after sign-in.
    const next = `${location.pathname}${location.search}${location.hash}`
    if (error instanceof ApiError && error.status === 401) location.href = `/featherbase/login?next=${encodeURIComponent(next)}`
    else root.render(<main><h1>Budgets</h1><p>Budgets could not open.</p><a href="/featherbase/admin">Back to Featherbase</a></main>)
  }
}
void boot()
