import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { setSession } from '../lib/api'
import { paintSavedTheme } from '../lib/theme'
import { createPrototypeRouter } from './PrototypeApp'
import { RelatedWorkspacePrototype } from './RelatedWorkspacePrototype'
import '../index.css'

// This entry is served only by the dev-only no-proxy prototype server. Its
// separate origin owns these synthetic credentials; never enter real ones here.
if (!import.meta.env.DEV) throw new Error('The synthetic lab is development-only')
const handshake = await fetch('/__lab/scenario')
if (handshake.headers.get('x-featherbase-synthetic') !== 'true') {
  throw new Error('Use the isolated prototype server; refusing to initialize against a normal API')
}
setSession('synthetic-ui-lab', { row_id: 'Administrator', full_name: 'Synthetic designer', email: null })
paintSavedTheme()
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const router = createPrototypeRouter(<RelatedWorkspacePrototype />)
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>,
)
