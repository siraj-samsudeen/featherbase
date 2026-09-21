import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskManagementPage } from './TaskManagement'
import { api } from './api'
import './style.css'

const root = createRoot(document.getElementById('root')!)
async function boot() {
try {
  const user = await api.get<{ row_id: string }>('/api/whoami')
  localStorage.setItem('fc_user', JSON.stringify(user))
  root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true },
  } })}><TaskManagementPage /></QueryClientProvider>)
} catch {
  root.render(<main><h1>Tasker</h1><p>Sign in to open your team's work.</p><a href="/featherbase/login?next=%2Ftasker%2F">Sign in to Featherbase</a></main>)
}
}
void boot()
