import { THEMES, THEME_CHANGE_EVENT, paintTheme, type Theme } from '@featherbase/shop-floor/theme'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskManagementPage } from './TaskManagement'
import { api } from './api'
import './style.css'

paintTheme('device')
window.addEventListener(THEME_CHANGE_EVENT, (event) => {
  const theme = (event as CustomEvent<{ theme: 'light' | 'dark' }>).detail?.theme
  if (theme === 'light' || theme === 'dark') paintTheme(theme)
})

const root = createRoot(document.getElementById('root')!)
async function boot() {
try {
  const user = await api.get<{ row_id: string; theme: Theme }>('/api/whoami')
  paintTheme(THEMES.includes(user.theme) ? user.theme : 'device')
  localStorage.setItem('fc_user', JSON.stringify(user))
  root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true },
  } })}><TaskManagementPage /></QueryClientProvider>)
} catch {
  root.render(<main><h1>Tasker</h1><p>Sign in to open your team's work.</p><a href="/featherbase/login?next=%2Ftasker%2F">Sign in to Featherbase</a></main>)
}
}
void boot()
