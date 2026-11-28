// The managers' review pages as a story (#1419): each page on the made-up chain beside a grey block where the
// Featherbase shell goes, as the agreed prototypes draw it. Open with the app's Vite dev server at
// /chain-story.html?page=store-review | category-review | rb-review (and &tab=…). No server, no sign-in; the
// real pages sit in the shell at /forecasting/?view=<page>.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RecordPagesProvider } from '@featherbase/shop-floor'
import { paintTheme } from '@featherbase/shop-floor/theme'
import { StoreManagerReview } from '../storeManager/StoreManagerReview'
import { CategoryHeadReview } from '../categoryHead/CategoryHeadReview'
import { RbReview } from '../rb/RbReview'
import { ownerOf, type ChainPageProps } from './chainPage'
import { madeUpChain } from './madeUpChain'
import '../style.css'

paintTheme('light')
const PAGES = { 'store-review': StoreManagerReview, 'category-review': CategoryHeadReview, 'rb-review': RbReview } as const
const q = new URLSearchParams(location.search)
const key = (q.get('page') ?? 'rb-review') as keyof typeof PAGES
const Page = PAGES[key] ?? RbReview
const href = (rowId: string) => { const x = new URLSearchParams(location.search); x.set('line', rowId); return `?${x}` }
const chain = madeUpChain()
// no sign-in here: the story views each page as an administrator would (?as=<made-up id> picks someone)
const owner = ownerOf(key in PAGES ? key : 'rb-review', chain, { admin: true, orgChart: false, employees: [], chiefs: [] }, q.get('as'))
const props: ChainPageProps = {
  chain, person: 'person' in owner ? owner.person : null, admin: true,
  hrefFor: l => href(l.rowId), openLine: q.get('line'),
  onOpenLine: rowId => { const x = new URLSearchParams(location.search); if (rowId) x.set('line', rowId); else x.delete('line'); history.replaceState(null, '', `?${x}`) },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0,1fr)', minHeight: '100vh' }}>
      <div aria-label="Featherbase shell (platform, not drawn)" style={{ display: 'flex', justifyContent: 'center', paddingTop: '40vh', background: 'var(--color-fill-hover)', color: 'var(--color-ink-subtle)', fontSize: 13, fontWeight: 500 }}>Featherbase shell</div>
      <main style={{ minWidth: 0, margin: 8, background: 'var(--color-surface)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-panel)' }}>
        <RecordPagesProvider pageFor={(table, rowId) => (table === 'forecasting.forecast_line_month' ? href(rowId) : undefined)}><Page {...props} /></RecordPagesProvider>
      </main>
    </div>
  </StrictMode>)
