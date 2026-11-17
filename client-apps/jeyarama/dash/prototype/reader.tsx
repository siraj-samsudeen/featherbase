// #1225 prototype: what a reader sees once a Dive is added store-aware, the worked example: the
// Jockey Women Dive, opened by a Team Leader of one section at store 1501. A MOCK of Dash's report
// page: the Dive frame is drawn here, not embedded, with the Store picker a v16-contract Dive would show.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Card, Segmented, StatusPill } from '@featherbase/shop-floor'
import './tailwind.css'
import './prototype.css'

const KERALA = ['1501 Attakulangara', '1502 Kaniyapuram', '1503 Pazhavangadi', '1504 Mall of Travancore',
  ...Array.from({ length: 13 }, (_, i) => `${1505 + i} Kerala store ${1505 + i}`)]
const SECTION = { name: "Women's Innerwear", subcategories: ['101010101', '101010102', '101010103', '101010104', '101010105', '101010106', '101010107', '101010108', '101010109', '101010110', '101010111', '101010112'] }
type When = 'before' | 'after' | 'closed'
type Say = 'strip' | 'panel'

function Reader() {
  const [when, setWhen] = useState<When>('after')
  const [say, setSay] = useState<Say>('strip')
  const [open, setOpen] = useState(false)
  const after = when === 'after'
  const stores = after ? [KERALA[0]] : KERALA
  const passed = [
    { what: 'The store it opens on', value: 'Attakulangara (1501)', key: 'store', sent: '"1501"' },
    { what: 'Your stores and subcategories', value: `Attakulangara: ${SECTION.name} only (${SECTION.subcategories.length} subcategories)`, key: 'reach', sent: `{ "1501": ["${SECTION.subcategories[0]}", … ${SECTION.subcategories.length} in all] }` },
    { what: 'The month', value: 'This month', key: 'month', sent: '"this"' },
  ]
  return (
    <div className="fd-shell">
      <featherbase-sidebar aria-label="Dash navigation"><a href="./index.html?view=access">Report access</a><a href="#" aria-current="page">Fashion · Jockey Women</a></featherbase-sidebar>
      <main className="fd-page" data-testid="reader-view">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-control border border-dashed border-border p-3" data-testid="reader-toggles">
            <span className="text-sm font-semibold">Prototype (#1225): a Team Leader of {SECTION.name} at Attakulangara (1501) opens the report. Made-up person; the Dive frame is a drawing.</span>
            <div className="flex flex-wrap items-center gap-2"><span className="w-28 text-sm text-ink-muted">The report</span>
              <Segmented label="Before or after" options={[{ value: 'before', label: 'Today: same for everyone' }, { value: 'after', label: 'Store-aware' }, { value: 'closed', label: 'Its Dive later drops the keys' }]} value={when} onChange={setWhen} /></div>
            <div className="flex flex-wrap items-center gap-2"><span className="w-28 text-sm text-ink-muted">Say what's passed</span>
              <Segmented label="How Dash says what it passes" options={[{ value: 'strip', label: '1 · A line above the Dive' }, { value: 'panel', label: '2 · An "About this report" panel' }]} value={say} onChange={setSay} /></div>
            <a className="text-sm font-semibold text-action underline" href="./index.html?view=access">← Back to Report access</a>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="fd-title">Fashion · Jockey Women</h1>
            {say === 'panel' && <Button variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="about-button">ⓘ About this report</Button>}
          </div>
          {say === 'strip' && when !== 'closed' && (after
            ? <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="passed-strip"><StatusPill tone="positive">Your store</StatusPill>Showing Attakulangara (1501), {SECTION.name} only · This month</p>
            : <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="passed-strip"><StatusPill tone="caution">Every store</StatusPill>This report shows every store, not only yours.</p>)}
          {say === 'panel' && open && when !== 'closed' && (
            <Card title="About this report" data-testid="about-panel">
              <div className="flex flex-col gap-2 p-4 text-sm">
                {after ? (
                  <>
                    <p>Dash passes this report what it knows about you, so it shows only your part of the business:</p>
                    <table className="w-full"><tbody>
                      {passed.map(row => (
                        <tr key={row.key} className="border-b border-border align-top"><td className="py-1 pe-3 text-ink-muted">{row.what}</td><td className="py-1 pe-3">{row.value}</td><td className="py-1"><code className="break-all text-xs">{row.key} = {row.sent}</code></td></tr>
                      ))}
                    </tbody></table>
                    <p className="text-ink-muted">From your job: Team Leader, {SECTION.name}, Attakulangara. If that's wrong, use Your sections.</p>
                  </>
                ) : <p>Dash passes this report nothing about you. It shows every store, whatever your job.</p>}
              </div>
            </Card>
          )}
          {when === 'closed' ? (
            <Card data-testid="report-closed">
              <div className="flex flex-col gap-2 p-4">
                <p className="font-semibold">This report is closed for now</p>
                <p className="text-sm">Its Dive was changed and no longer shows only your stores, so Dash won't open it. The people who manage reports have been told. Your other reports are in the left pane.</p>
              </div>
            </Card>
          ) : (
          <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4" data-testid="dive-frame">
            <span className="text-xs text-ink-muted">The Dive, as MotherDuck draws it inside Dash</span>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-lg font-semibold">Jockey Women — Attakulangara</p><p className="text-sm text-ink-muted">Sales qty, stock on hand by SKU and size, cover days</p></div>
              <label className="flex flex-col text-sm"><span className="text-ink-muted">Store (Kerala)</span>
                <select className="min-h-control rounded-control border border-border-control bg-surface px-2" data-testid="dive-store-picker" defaultValue={KERALA[0]}>
                  {stores.map(store => <option key={store}>{store.replace(/^(\d+) (.*)$/, '$2 ($1)')}</option>)}
                </select>
                <span className="text-xs text-ink-muted" data-testid="picker-count">{stores.length === 1 ? 'Only your store' : `All ${stores.length} Kerala stores`}</span>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['67', 'Sales qty, last 30 days'], ['295', 'Stock on hand qty'], ['132', 'Stock cover days'], ['39', 'SKUs stocked out']].map(([n, label]) => (
                <div key={label}><p className="text-2xl font-bold">{n}</p><p className="text-xs text-ink-muted">{label}</p></div>
              ))}
            </div>
          </section>
          )}
        </div>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Reader />)

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX { interface IntrinsicElements { 'featherbase-sidebar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> } }
}
