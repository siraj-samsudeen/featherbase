// The RB (Chief Executive) review: both regions, every store, any level. STUB: the frame, tiles and one tree,
// to prove the shared parts compose; the full page (four layouts, Approvals, Help) is built on top of this.
import { useMemo, useState } from 'react'
import { madeUpChain, SMALL_UNDER } from '../shared/madeUpChain'
import { combine, foldSmall } from '../shared/model'
import { LEVEL } from '../shared/levels'
import { KpiTiles } from '../shared/KpiTiles'
import { ReviewFrame, useLayout } from '../shared/ReviewFrame'
import { ReviewTree } from '../shared/ReviewTree'
import { MANAGER_VIEW, PartsLegend, ReviewToolbar } from '../shared/ReviewToolbar'
import { useScope } from '../shared/ScopeSearch'
import { useChainReview } from '../shared/useChainReview'
import { chainHeader, type ChainPageProps } from '../shared/chainPage'
import type { SortKey } from '../shared/MeasureTable'
import '../shared/forecasting.css'

const LAYOUTS = [{ id: 'two-tabs', label: 'Two Tabs' }]

export function RbReview({ hrefFor, openLine, onOpenLine }: ChainPageProps) {
  const chain = madeUpChain()
  const all = useMemo(() => foldSmall(chain.lines, SMALL_UNDER), [chain.lines])
  const header = chainHeader('Kumar', 'Chief Executive')
  const review = useChainReview(chain.proposals)
  const scope = useScope(all)
  const [layout, setLayout] = useLayout(LAYOUTS)
  const [tab, setTab] = useState('review')
  const [view, setView] = useState(MANAGER_VIEW)
  const [sort, setSort] = useState<SortKey>('aop')
  const [openNodes, setOpenNodes] = useState(new Set<string>())
  const [open, setOpen] = useState<string | null>(openLine)
  const lines = scope.lines
  const regions = [...new Set(all.map(l => l.region))]
  const content = <>
    <KpiTiles total={combine(lines, -1)}
      header={header} approvedDelta={review.approvedDelta(lines)} />
    <ReviewToolbar value={view} onChange={setView} toggles={['measure', 'groups', 'shape']} wrap />
    <PartsLegend hint="Click a row to open it; click a subcategory for how Feather Forecast built it." />
    <ReviewTree header={header} view={view} lines={lines} levels={[LEVEL.region, LEVEL.store, LEVEL.division, LEVEL.category]} totalLabel="Both regions"
      sort={sort} onSort={setSort} openNodes={openNodes} onToggleNode={id => setOpenNodes(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })}
      open={open} onOpen={k => { setOpen(k); onOpenLine(k) }} hrefFor={hrefFor} smallUnder={SMALL_UNDER}
      linePills={l => review.linePills(l, false)} />
  </>
  return (
    <ReviewFrame testId="rb-review" title={`${regions.join(' and ')} · ${header.month.label}`}
      status={`${header.person} · ${header.role} · ${new Set(all.map(l => l.store)).size} stores · sales to ${header.cutOff} · before tax`}
      all={all} scope={scope} layouts={LAYOUTS} layout={layout} onLayout={setLayout} tab={tab} onTab={setTab}
      tabs={[{ id: 'review', label: 'Both Regions', content }, { id: 'approvals', label: `Approvals (${review.waiting.length})`, content: null }, { id: 'help', label: 'Help', content: null }]} />
  )
}
