// #1225 prototype entry: the real Report access page on made-up data (made-up-api.ts).
import { createRoot } from 'react-dom/client'
import { ReportAccess } from '../src/access-page'
import { opensTable } from './made-up-api'

// Answer #1223's "may this viewer open this Table?" from the made-up viewer, as the server would.
const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const meta = url.match(/\/api\/table\/([^/]+):meta$/)
  if (meta) return Promise.resolve(new Response('{}', { status: opensTable(decodeURIComponent(meta[1])) ? 200 : 403 }))
  return realFetch(input, init)
}
import './tailwind.css'
import './prototype.css'

;(window as { dashPrototype?: boolean }).dashPrototype = true
createRoot(document.getElementById('root')!).render(<ReportAccess />)
