// The Report access page (#1046), in Shop Floor's components, for Report Access Managers and
// System Managers: add a MotherDuck Dive as a report (#1169); give a report or a bundle to a person, a role or a job; see who has what and
// take it away; look a person up to see what they see, and why. The rules are the server's
// (report-access-server.ts): the page only asks.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Plus, UserRound, X } from '@featherbase/shop-floor'
import { iconButtonClasses, ToastProvider, useToast } from '@featherbase/shop-floor'
import { SameForEveryone } from './pills'
import { Button, Card, DataList, EmptyState, Field, KindTag, Notice, SearchInput, Segmented, Select, Skeleton, StatusPill, TextInput, type DataColumn } from '@featherbase/shop-floor'
import { act, mayViewAs, read, startViewAs } from './api'
import { DashSidebar } from './sections-page'
import { PickerToggle, TeamNote, TeamSelect, keepPickerLayout, startPickerLayout, type PickerLayout, type TeamMember } from './team-access-page'
import { diveIdIn, matchingDives, type DiveChoice } from './add-dive'
import { AddDivePage } from './add-dive-page'
import { Menu, type MenuItem } from './menu'
import { diveLink, ownerInstruction } from './dive-contract'
import { RECORD, RecordLink } from './record-link'
import { AREAS, areaCounts, bundleAreas, inArea, reportAreas, type Area } from './area-tags'
import { PeopleLayoutProvider, PeopleLayoutToggle, PersonName, personWithCode, usePeopleLayout, type Who } from './person-identity'

type Kind = 'Person' | 'Role' | 'Job'
/** #1225: `gives.id`, `to.id` and `given_by_id` are the records the names link to (a report key, a bundle id, an Employee, a Role, a Job). */
interface Row { id: string; updated_at: string; gives: { kind: 'Report' | 'Bundle'; name: string; id?: string }; to: { kind: Kind; name: string; who?: Who; id?: string }; given_by: string; given_by_id?: string | null; given_on: string; removable?: boolean }
const KIND_OF: Record<Kind | 'Report' | 'Bundle', string> = { Person: RECORD.employee, Role: RECORD.role, Job: RECORD.job, Report: RECORD.report, Bundle: RECORD.bundle }
/** A grant's receiver: a person with their identity, or a role or a job, each a link to its record. */
function Receiver({ to }: { to: Row['to'] }) {
  return to.kind === 'Person' ? <PersonName name={to.name} who={to.who} id={to.id} /> : <RecordLink table={KIND_OF[to.kind]} id={to.id}>{to.name}</RecordLink>
}
interface Page {
  /** #1217: 'team' for a Team Report Manager, who gives only to `team`. */
  scope?: 'company' | 'team'
  team?: TeamMember[]
  /** #1225 (prototype): how each report filters, for the catalogue's "Who sees what". */
  reports: { key: string; name: string; filter_shape?: string; pickers_in_dive?: boolean
    /** #1225 (prototype): added the same for everyone while its Dive's owner makes it store-aware. */
    waiting_for_owner?: boolean
    /** #1225 (prototype): areas chosen when it was added; else its name gives them. */
    areas?: Area[] | null
    /** #1225 (prototype): why Dash won't open it: its Dive stopped taking each person's stores. */
    closed?: string | null
    /** #1225 (prototype): the last switch, who or what made it, and the Dive version. */
    last_change?: string | null
    dive_owner?: string | null
    dive_title?: string | null
    dive_id?: string | null }[]
  bundles: { id: string; name: string; reports: { member: string; updated_at: string; key: string; name: string }[] }[]
  roles: string[]
  jobs: string[]
  rows: Row[]
  waiting: { person: string; name: string; asked_on: string; who?: Who }[]
}
export interface Found extends Who { person: string; name: string }
interface Lookup { name: string; reports: { key: string; name: string; because: string[]; closed: string | null }[] }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not go through. Try again.')
/** A day as staff read it: 07-Nov-2026. */
const dayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return `${String(d).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}-${y}`
}

export function ReportAccess() {
  const [page, setPage] = useState<Page | undefined>()
  const [failed, setFailed] = useState<string | null>(null)
  const load = useCallback(() => read<Page>('access_page').then(answer => { setPage(answer); setFailed(null) }, error => setFailed(messageOf(error))), [])
  useEffect(() => { void load() }, [load])
  const company = page && page.scope !== 'team'
  return (
    <ToastProvider>
    <PeopleLayoutProvider>
      <div className="fd-shell">
        <DashSidebar current="access" />
        <main className="fd-page" data-testid="report-access">
          {/* UI standard §3: left-aligned, lists up to 1280px wide, 32px from the sidebar. */}
          <div className="flex w-full max-w-[1280px] flex-col gap-4 sm:ps-4">
            {!company && !(page?.scope === 'team' && prototyping()) && <h1 className="fd-title">Report access</h1>}
            {!page && !failed && <Skeleton label="Opening report access" lines={6} />}
            {failed && !page && (
              <Card data-testid="access-refused"><EmptyState title="This page couldn't open" body={failed} action={failed.startsWith('Only a Report Access Manager') ? undefined : <Button onClick={() => void load()}>Try again</Button>} /></Card>
            )}
            {page && page.scope === 'team' && <TeamAccess page={page} onChanged={load} />}
            {page && company && <CompanyAccess page={page} onChanged={load} />}
          </div>
        </main>
      </div>
    </PeopleLayoutProvider>
    </ToastProvider>
  )
}

/**
 * #1225: the page's layouts and Add a Dive's ways, on trial. Only the made-up prototype
 * (prototype/main.tsx) sets this; real Dash keeps today's one column and today's Add a Dive,
 * because the trial ways send keys the server does not take yet.
 */
const prototyping = () => (window as { dashPrototype?: boolean }).dashPrototype === true

// Siraj chose A · Tabs (16-Nov-2026); B and C are gone. Today's page stays for comparison.
export type AccessLayout = 'tabs' | 'column'
const LAYOUTS: { value: AccessLayout; label: string }[] = [{ value: 'tabs', label: 'New page (A · Tabs)' }, { value: 'column', label: 'Today' }]
type Section = 'reports' | 'who' | 'bundles' | 'lookup' | 'waiting'
const SECTIONS: Section[] = ['reports', 'who', 'bundles', 'lookup', 'waiting']

function fromAddress<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = new URLSearchParams(window.location.search).get(name)
  return allowed.includes(value as T) ? (value as T) : fallback
}
function keepInAddress(name: string, value: string) {
  const url = new URL(window.location.href)
  url.searchParams.set(name, value)
  window.history.replaceState(null, '', url)
}

/** Brings the bundle the address names (`?bundle=`) into view and marks it, once the page has drawn it. */
export function showBundleInAddress() {
  const id = new URLSearchParams(window.location.search).get('bundle')
  const found = id ? [...document.querySelectorAll('[data-bundle-id]')].find(el => el.getAttribute('data-bundle-id') === id) : undefined
  if (!found) return
  found.setAttribute('aria-current', 'true')
  found.scrollIntoView?.({ block: 'center' })
}

/** The top of the page, whichever element scrolls it. */
const toTop = () => { window.scrollTo(0, 0); document.body.scrollTop = 0; document.documentElement.scrollTop = 0 }

type Panel = { kind: 'give'; report?: string; person?: Found; n: number } | { kind: 'bundle'; n: number } | null

/** The company page: a Report Access Manager's or a System Manager's. */
function CompanyAccess({ page, onChanged }: { page: Page; onChanged: () => Promise<unknown> }) {
  const trial = prototyping()
  const toast = useToast()
  const [layout, setLayout] = useState<AccessLayout>(() => (trial ? fromAddress('layout', LAYOUTS.map(l => l.value), 'tabs') : 'column'))
  // #1225: Add a Dive is a page of its own, in the address so Back returns to Report access.
  const [adding, setAdding] = useState(() => trial && new URLSearchParams(window.location.search).get('page') === 'add-dive')
  // The report just added: its row is highlighted until the next thing is done.
  const [fresh, setFresh] = useState<string | null>(null)
  useEffect(() => {
    const back = () => setAdding(new URLSearchParams(window.location.search).get('page') === 'add-dive')
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])
  const openAddDive = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('page', 'add-dive')
    window.history.pushState(null, '', url)
    setFresh(null)
    setAdding(true)
    toTop()
  }
  const leaveAddDive = (added: { key: string; name: string; eachStore: boolean } | null) => {
    const url = new URL(window.location.href)
    url.searchParams.delete('page')
    window.history.pushState(null, '', url)
    setAdding(false)
    toTop()
    if (!added) return
    go('reports')
    setFresh(added.key)
    toast({ tone: 'positive', message: (
      <span className="flex flex-wrap items-center gap-2" data-testid="dive-added">
        {added.name} is added{added.eachStore ? '. Each person sees only their stores' : ''}. Give it to people?
        <Button data-action variant="quiet" onClick={() => give(added.key)} data-testid="toast-give">Give</Button>
      </span>
    ) })
  }
  const [section, setSection] = useState<Section>(() => fromAddress('section', SECTIONS, 'reports'))
  // #1218: a bundle's record link opens this page on that bundle.
  useEffect(() => { showBundleInAddress() }, [section, layout])
  // #1225: the area chosen, one for the reports and the bundles, kept in the address (#1228's
  // remembered filters will take it over).
  const [area, setArea] = useState<Area | null>(() => { const chosen = fromAddress('area', [...AREAS, 'all'] as const, 'all'); return chosen === 'all' ? null : chosen })
  const chooseArea = (next: Area | null) => { setArea(next); keepInAddress('area', next ?? 'all') }
  const [reportsView, setReportsView] = useState<'list' | 'folders'>(() => fromAddress('areas', ['list', 'folders'] as const, 'list'))
  // Who has what, narrowed to one report from the Reports tab's "Given to" link.
  const [onlyReport, setOnlyReport] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  // A remove starts the Give bar afresh, so its last "is given" message doesn't outlive the row.
  const [removals, setRemovals] = useState(0)
  const onRemoved = () => { setRemovals(n => n + 1); return onChanged() }
  const go = (next: Section) => { setSection(next); keepInAddress('section', next) }
  // #1225: every form opens right under the page's title, in view, whatever section is showing.
  const open = (next: Panel) => { setPanel(next); setFresh(null) }
  // Scroll the opened form itself into view: Dash's page may scroll the body, not the window (verifier r6).
  const panelBox = useRef<HTMLDivElement>(null)
  useEffect(() => { if (panel) panelBox.current?.scrollIntoView({ block: 'nearest' }) }, [panel])
  const give = (what?: string) => open({ kind: 'give', report: what, n: Date.now() })
  const newBundle = () => open({ kind: 'bundle', n: Date.now() })
  const close = () => setPanel(null)
  const people = usePeopleLayout()

  const giveBar = (what?: string, closable = true, person?: Found) => <GiveBar key={`${removals}-${panel?.n ?? 0}`} page={page} onGiven={onChanged} start={what ? (what.startsWith('bundle:') ? what : `report:${what}`) : ''} startPerson={person} onClose={closable ? close : undefined} />
  const panelNode = panel?.kind === 'give' ? giveBar(panel.report, true, panel.person)
    : panel?.kind === 'bundle' ? <NewBundle key={panel.n} page={page} onClose={close} onMade={async () => { await onChanged(); go('bundles') }} />
      : null
  const counts: Record<Section, number | undefined> = { reports: page.reports.length, who: page.rows.length, bundles: page.bundles.length, lookup: undefined, waiting: page.waiting.length }
  const LABELS: Record<Section, string> = { reports: 'Reports', who: 'Who has what', bundles: 'Bundles', lookup: 'Look up a person', waiting: 'Waiting' }
  const parts: Record<Section, ReactNode> = {
    reports: <ReportsCatalogue page={page} onGive={key => give(key)} onTouched={() => setFresh(null)} onChanged={onChanged} area={area} onArea={chooseArea}
      view={reportsView} fresh={fresh} onAddDive={openAddDive} onShowWho={key => { setOnlyReport(key); go('who') }} />,
    who: <WhoHasWhat rows={page.rows} onRemoved={onRemoved} onGive={() => give()}
      only={onlyReport ? { name: page.reports.find(report => report.key === onlyReport)?.name ?? '', key: onlyReport, bundles: page.bundles.filter(bundle => bundle.reports.some(held => held.key === onlyReport)).map(bundle => bundle.name) } : null}
      onClearOnly={() => setOnlyReport(null)} />,
    bundles: <BundleCards page={page} rows={page.rows} onChanged={onChanged} onNew={newBundle} area={area} onArea={chooseArea} onGiveBundle={id => give(`bundle:${id}`)} />,
    lookup: <PersonLookup />,
    waiting: page.waiting.length ? <Waiting waiting={page.waiting} onGive={found => open({ kind: 'give', person: found, n: Date.now() })} onChanged={onChanged} />
      : <Card><EmptyState title="Nobody is waiting for a report" body="When someone opens Dash with no report, they show here so you can give them one." action={<Button data-action onClick={() => give()}>Give a report</Button>} /></Card>,
  }
  const header = (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="fd-title">Report access</h1>
        {layout === 'tabs' && (
          <div className="flex flex-wrap items-center gap-2" data-testid="page-actions">
            <Menu label="New" testid="open-new" trigger={<><Plus aria-hidden size={18} />New<ChevronDown aria-hidden size={16} /></>} items={[
              { label: 'Bundle', onSelect: newBundle, testid: 'open-new-bundle' },
              { label: 'Report from a Dive', onSelect: openAddDive, testid: 'open-add-dive' },
            ]} />
            <Button variant="primary" icon={<UserRound aria-hidden size={18} />} onClick={() => give()} data-testid="open-give">Give a report</Button>
          </div>
        )}
      </div>
      {layout === 'tabs' && (
        <details className="text-sm text-ink-muted" data-testid="how-access-works">
          <summary className="w-fit cursor-pointer">How access works</summary>
          <p className="mt-1 max-w-[70ch]">A person sees every report given to them, through a role they hold, or through their current job. What a report shows them still follows their job: a report that takes each person's stores shows only theirs.</p>
        </details>
      )}
    </div>
  )
  if (adding) return <AddDivePage onAdded={onChanged} onLeave={leaveAddDive} />
  return (
    <>
      {header}
      {layout === 'tabs' && panelNode && <div ref={panelBox} className="scroll-mt-4">{panelNode}</div>}
      {trial && (
        <details className="flex flex-col gap-2 rounded-control border border-dashed border-border p-3 [&[open]>summary]:mb-2" data-testid="trial-toggles">
          <summary className="cursor-pointer text-sm font-semibold">Prototype controls (made-up data, #1225)</summary>
          <div className="flex flex-wrap items-center gap-2"><span className="w-24 text-sm text-ink-muted">Layout</span>
            <Segmented label="Page layout" options={LAYOUTS} value={layout} onChange={value => { setLayout(value); keepInAddress('layout', value); setPanel(null) }} /></div>
          <div className="flex flex-wrap items-center gap-2"><span className="w-24 text-sm text-ink-muted">Signed in as</span>
            <Segmented label="Signed in as" options={[{ value: 'system', label: 'System Manager: every record a link' }, { value: 'ram', label: 'Report Access Manager: reports and bundles only' }]}
              value={new URLSearchParams(window.location.search).get('viewer') === 'ram' ? 'ram' : 'system'}
              onChange={value => { keepInAddress('viewer', value); window.location.reload() }} /></div>
          <a className="text-sm font-semibold text-action hover:underline" href="./reader.html" data-testid="reader-link">See what a reader sees: the worked example, a Team Leader at store 1501 →</a>
        </details>
      )}
      {layout === 'column' && (
        <>
          <p className="fd-muted">A person sees every report given to them, through a role they hold, or through their current job. What a report shows them still follows their job.</p>
          <PeopleLayoutToggle />
          {giveBar(undefined, false)}
          <WhoHasWhat rows={page.rows} onRemoved={onRemoved} />
          <PersonLookup />
          <Bundles page={page} onChanged={onChanged} />
          <AddDive onAdded={onChanged} />
          {page.waiting.length > 0 && <Waiting waiting={page.waiting} />}
        </>
      )}
      {layout === 'tabs' && (
        <div className="flex flex-col gap-4" data-testid="layout-tabs">
          {/* Not Shop Floor's ContentTabs: its panel scrolls inside a fixed-height pane, and this page scrolls as a whole. */}
          <div role="tablist" aria-label="Report access" className="flex flex-wrap items-center gap-x-4 border-b border-border">
            {SECTIONS.map(id => (
              <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => go(id)} data-testid={`tab-${id}`}
                className={`inline-flex min-h-control shrink-0 items-center gap-2 border-b-2 px-1 py-2 text-control font-semibold ${section === id ? 'border-action text-action' : 'border-transparent text-ink-muted hover:text-ink'}`}>
                {LABELS[id]}
                {counts[id] !== undefined && (
                  <span className={`rounded-full px-2 text-xs ${id === 'waiting' && counts[id]! > 0 ? 'bg-caution-tint text-caution' : section === id ? 'bg-action-tint text-action' : 'bg-subtle text-ink-muted'}`} data-testid={`tab-count-${id}`}>{counts[id]}</span>
                )}
              </button>
            ))}
            {/* Preferences, not page sections: how people and reports are drawn. */}
            <Menu label="View" className="ms-auto" testid="view-menu" trigger={<>View<ChevronDown aria-hidden size={16} /></>}
              triggerClassName="inline-flex min-h-control items-center gap-1 rounded-control px-2 text-control font-medium text-ink-muted hover:bg-subtle hover:text-ink"
              items={[
                { heading: 'Show people as' },
                ...people.options.map(option => ({ label: option.label, checked: people.layout === option.value, onSelect: () => people.setLayout(option.value), testid: `view-people-${option.value}` })),
                { heading: 'Show reports as' },
                { label: 'One list', checked: reportsView === 'list', onSelect: () => { setReportsView('list'); keepInAddress('areas', 'list') }, testid: 'view-reports-list' },
                { label: 'Folders by area', checked: reportsView === 'folders', onSelect: () => { setReportsView('folders'); keepInAddress('areas', 'folders') }, testid: 'view-reports-folders' },
              ]} />
          </div>
          <div role="tabpanel" className="min-w-0">{parts[section]}</div>
        </div>
      )}
    </>
  )
}

/** #1225: the areas a report or bundle sits in, as small labels. */
function AreaLabels({ areas }: { areas: readonly Area[] }) {
  return <>{areas.map(each => <span key={each} className="rounded-full border border-border px-2 text-xs font-normal text-ink-muted" data-testid="area-label">{each}</span>)}</>
}

/** #1225: "All 8 · Sales 3 · Inventory 1 …": one chip per area with reports; the chosen one filled; Clear. */
function AreaBar({ counts, total, area, onChange, label }: { counts: { area: Area; count: number }[]; total: number; area: Area | null; onChange: (area: Area | null) => void; label: string }) {
  const chip = (value: Area | null, text: string, count: number) => (
    <button key={text} type="button" aria-pressed={area === value} onClick={() => onChange(value)} data-testid="area-chip" data-area={value ?? 'all'}
      className="min-h-8 rounded-full border border-border-control px-3 text-sm text-ink hover:bg-subtle aria-pressed:border-action aria-pressed:bg-action-tint aria-pressed:font-semibold aria-pressed:text-action">
      {text} <span className="text-ink-muted">{count}</span>
    </button>
  )
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2" data-testid="area-bar">
      {chip(null, 'All', total)}
      {counts.map(row => chip(row.area, row.area, row.count))}
      {/* An area chosen in the address but empty here still shows, so it can be cleared. */}
      {area && !counts.some(row => row.area === area) && chip(area, area, 0)}
      {area && <button type="button" className="text-sm font-medium text-action hover:underline" onClick={() => onChange(null)} data-testid="area-clear">Clear filters</button>}
    </div>
  )
}

/** #1225: what a report shows each reader, in one vocabulary across Dash. */
function WhoSees({ report }: { report: Page['reports'][number] }) {
  if (report.closed) return <StatusPill tone="negative">Closed</StatusPill>
  if (report.waiting_for_owner) return <StatusPill tone="caution">Every store, for now</StatusPill>
  if (!report.filter_shape) return null
  return report.filter_shape === 'No filter' && !report.pickers_in_dive
    ? <SameForEveryone />
    : <StatusPill tone="positive">Each person's stores</StatusPill>
}


type ReportRow = Page['reports'][number]
type CheckAnswer = { switched: boolean; closed?: boolean; version: number | null; missing?: string[] }

/** #1225: every report in one table: its areas, what it shows, who has it, its bundles, and actions. */
function ReportsCatalogue({ page, onGive, onChanged, onTouched = () => {}, area, onArea, view, fresh, onAddDive, onShowWho }: {
  page: Page; onGive: (report: string) => void; onChanged: () => Promise<unknown>
  /** #1225: the area chosen on the page, shared with Bundles. */
  area: Area | null; onArea: (area: Area | null) => void
  view: 'list' | 'folders'
  /** The report just added, highlighted. */
  fresh: string | null
  onAddDive: () => void
  /** "Given to …": Who has what, narrowed to this report. */
  onShowWho: (report: string) => void
  /** Anything done to a row: the page's last notice is out of date. */
  onTouched?: () => void }) {
  const trial = prototyping()
  const toast = useToast()
  // The report just added is highlighted; bring it into view.
  useEffect(() => { if (fresh) document.querySelector(`[data-fresh="true"]`)?.scrollIntoView({ block: 'center' }) }, [fresh])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [said, setSaid] = useState<{ key: string; tone: 'positive' | 'caution' | 'negative' | 'info'; text: string } | null>(null)
  async function run(report: ReportRow, work: () => Promise<{ tone: 'positive' | 'caution' | 'negative' | 'info'; text: string } | null>) {
    setBusy(report.key)
    setSaid(null)
    onTouched()
    try {
      const outcome = await work()
      await onChanged()
      if (outcome) setSaid({ key: report.key, ...outcome })
    } catch (failure) {
      setSaid({ key: report.key, tone: 'negative', text: messageOf(failure) })
    } finally {
      setBusy(null)
    }
  }
  /**
   * #1225 (a): "the owner has done it". The server reads the Dive's source now and switches the
   * report only if the keys are there: a claim alone never switches it.
   */
  const checkNow = (report: ReportRow) => run(report, async () => {
    const answer = await act<CheckAnswer>('recheck_report', { report: report.key })
    const version = answer.version ? ` (version ${answer.version})` : ''
    return answer.switched
      ? { tone: 'positive', text: `Dash read the Dive${version}: it now takes each person's stores. ${report.name} shows each person only their stores.` }
      : { tone: 'caution', text: `Dash read the Dive${version}: it doesn't take each person's stores yet, so ${report.name} stays the same for everyone. The owner's note says what to change.` }
  })
  const remove = (report: ReportRow) => run(report, async () => {
    await act('retire_report', { report: report.key })
    setRemoving(null)
    toast({ tone: 'positive', message: <span data-testid="catalogue-removed">{report.name} is no longer in Dash. Its history is kept; the Dive is still in MotherDuck and can be added again.</span> })
    return null
  })
  async function copyNote(report: ReportRow) {
    const note = ownerInstruction(report.dive_title!, diveLink(report.dive_title!, report.dive_id!))
    try { await navigator.clipboard.writeText(note) } catch { /* nothing to copy into */ }
    onTouched()
    toast({ tone: 'positive', message: <span data-testid="note-copied">The note for {report.dive_owner ?? 'its owner'} is copied. Paste it into a message to them.</span> })
  }
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = page.reports.filter(report => words.every(word => report.name.toLowerCase().includes(word))).filter(report => inArea(report, area))
  const holders = (report: ReportRow) => {
    const bundles = page.bundles.filter(bundle => bundle.reports.some(held => held.key === report.key))
    const names = bundles.map(bundle => bundle.name)
    return { bundles, rows: page.rows.filter(row => (row.gives.kind === 'Report' && row.gives.name === report.name) || (row.gives.kind === 'Bundle' && names.includes(row.gives.name))) }
  }
  const count = (rows: Row[], kind: Kind) => rows.filter(row => row.to.kind === kind).length
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const renderRows = (report: ReportRow) => {
    const held = holders(report)
    const summary = [count(held.rows, 'Person') && plural(count(held.rows, 'Person'), 'person', 'people'), count(held.rows, 'Role') && plural(count(held.rows, 'Role'), 'role'), count(held.rows, 'Job') && plural(count(held.rows, 'Job'), 'job')].filter(Boolean)
    const waitingOrClosed = Boolean(report.waiting_for_owner || report.closed)
    const actions: MenuItem[] = [
      ...(waitingOrClosed && report.dive_title && report.dive_id ? [{ label: 'Copy the note for the Dive owner', onSelect: () => void copyNote(report), testid: 'catalogue-copy-note' }] : []),
      { label: 'Remove the report…', tone: 'negative' as const, onSelect: () => { setSaid(null); onTouched(); setRemoving(report.key) }, testid: 'catalogue-remove' },
    ]
    return [
      <tr key={report.key} className={`border-b border-border align-top ${fresh === report.key ? 'bg-action-tint' : ''}`} data-testid="catalogue-report" data-fresh={fresh === report.key || undefined}>
        <td className="py-3 pe-3">
          <div className="flex flex-col gap-1">
            <RecordLink table={RECORD.report} id={report.key} className="font-medium">{report.name}</RecordLink>
            {report.waiting_for_owner && <span className="text-sm text-caution" data-testid="catalogue-waiting">Waiting for {report.dive_owner ?? 'its owner'} to make the Dive show each person only their stores. Dash checks again whenever someone opens it.</span>}
            {report.closed && <span className="text-sm text-negative" data-testid="catalogue-closed">{report.closed}</span>}
            {report.last_change && <span className="text-xs text-ink-muted" data-testid="catalogue-change">{report.last_change}</span>}
          </div>
        </td>
        <td className="py-3 pe-3"><span className="flex flex-wrap gap-1"><AreaLabels areas={reportAreas(report)} /></span></td>
        <td className="py-3 pe-3"><WhoSees report={report} /></td>
        <td className="py-3 pe-3 text-sm">
          {held.rows.length
            ? <button type="button" className="text-start font-medium text-action hover:underline" onClick={() => onShowWho(report.key)} data-testid="catalogue-who">{summary.join(' · ')}</button>
            : <span className="text-ink-muted">Nobody yet</span>}
        </td>
        <td className="py-3 pe-3 text-sm">
          {held.bundles.length ? held.bundles.map((bundle, n) => <span key={bundle.id}>{n > 0 && ', '}<RecordLink table={RECORD.bundle} id={bundle.id}>{bundle.name}</RecordLink></span>) : <span className="text-ink-muted">—</span>}
        </td>
        <td className="py-1.5 pe-1">
          <div className="flex items-center justify-end gap-1">
            {waitingOrClosed && <Button data-action variant="quiet" loading={busy === report.key} onClick={() => void checkNow(report)} data-testid="catalogue-recheck">Check the Dive now</Button>}
            <Button data-action variant="quiet" onClick={() => onGive(report.key)} disabled={Boolean(report.closed)} title={report.closed ? "A closed report can't be given until its Dive shows each person only their stores again" : undefined} data-testid="catalogue-give">Give</Button>
            <Menu label={`More for ${report.name}`} testid="catalogue-more" trigger={<span aria-hidden className="px-1 text-lg leading-none">⋯</span>}
              triggerClassName={iconButtonClasses()} items={actions} />
          </div>
        </td>
      </tr>,
      ...(removing === report.key || said?.key === report.key || (trial && report.dive_owner) ? [
        <tr key={`${report.key}-more`} className="border-b border-border">
          <td colSpan={6} className="pb-3">
            <div className="flex flex-col gap-2">
              {removing === report.key && (
                <div className="flex flex-wrap items-center gap-2 rounded-control border border-negative p-3" data-testid="remove-report-confirm">
                  <span className="min-w-0 text-sm [overflow-wrap:anywhere]">Remove {report.name} from Dash? {held.rows.length ? `${plural(held.rows.length, 'person, role or job', 'people, roles or jobs')} lose${held.rows.length === 1 ? 's' : ''} it` : 'Nobody has it'}{held.bundles.length ? `, and it leaves ${held.bundles.map(bundle => bundle.name).join(', ')}` : ''}. Its history is kept, and the Dive stays in MotherDuck.</span>
                  <Button data-action variant="danger" loading={busy === report.key} onClick={() => void remove(report)} data-testid="remove-report-yes">Remove the report</Button>
                  <Button variant="quiet" onClick={() => setRemoving(null)}>Cancel</Button>
                </div>
              )}
              {said?.key === report.key && <Notice tone={said.tone}><span data-testid="catalogue-checked">{said.text}</span></Notice>}
              {trial && report.dive_owner && (
                <div className="flex flex-wrap items-center gap-2 rounded-control border border-dashed border-border p-2 text-xs [&_button]:h-auto [&_button]:min-h-0 [&_button]:whitespace-normal [&_button]:py-1 [&_button]:text-start" data-testid="prototype-events">
                  <span className="text-ink-muted">Prototype, pretend that:</span>
                  <Button data-action variant="quiet" onClick={() => void run(report, async () => { await act('prototype_owner_saves', { report: report.key, reach: true }); return { tone: 'info', text: `${report.dive_owner} saved a new version that takes each person's stores. Nobody has told Dash.` } })} data-testid="pretend-owner-fixes">the owner saves a version that takes each person's stores</Button>
                  <Button data-action variant="quiet" onClick={() => void run(report, async () => { await act('prototype_owner_saves', { report: report.key, reach: false }); return { tone: 'info', text: `${report.dive_owner} saved a new version that shows every store again. Nobody has told Dash.` } })} data-testid="pretend-owner-breaks">the owner saves a version that shows every store</Button>
                  <Button data-action variant="quiet" onClick={() => void run(report, async () => {
                    const answer = await act<CheckAnswer & { checked: boolean }>('prototype_reader_opens', { report: report.key })
                    return { tone: answer.closed ? 'negative' : answer.switched ? 'positive' : 'info', text: !answer.checked ? 'A reader opened it. The Dive has not changed since Dash last read it, so Dash did not read it again.'
                      : answer.closed ? 'A reader opened it. Dash read the new version, found it shows every store, and refused to open it.'
                        : answer.switched ? 'A reader opened it. Dash read the new version, found it takes each person\'s stores, and switched the report before showing it.'
                          : 'A reader opened it. Dash read the new version: nothing changed.' }
                  })} data-testid="pretend-reader-opens">a reader opens the report</Button>
                </div>
              )}
            </div>
          </td>
        </tr>,
      ] : []),
    ]
  }
  const head = (
    <thead><tr className="border-b border-border text-start text-[13px] text-ink-muted">
      <th className="py-2 pe-3 text-start font-medium">Report</th><th className="py-2 pe-3 text-start font-medium">Area</th>
      <th className="py-2 pe-3 text-start font-medium">What each person sees</th><th className="py-2 pe-3 text-start font-medium">Given to</th>
      <th className="py-2 pe-3 text-start font-medium">In bundles</th><th className="py-2"><span className="sr-only">Actions</span></th>
    </tr></thead>
  )
  const groups: { title: string | null; rows: ReportRow[] }[] = view === 'list' ? [{ title: null, rows: shown }]
    : [...AREAS.filter(each => !area || each === area).map(each => ({ title: each as string, rows: shown.filter(report => reportAreas(report).includes(each)) })),
      ...(area ? [] : [{ title: 'No area yet', rows: shown.filter(report => reportAreas(report).length === 0) }])].filter(group => group.rows.length)
  return (
    <Card title={<span>All reports <span className="font-normal text-ink-muted">{page.reports.length}</span></span>} data-testid="catalogue"
      actions={<Button icon={<Plus aria-hidden size={18} />} onClick={onAddDive} data-testid="catalogue-add-dive">Add a Dive</Button>}>
      <div className="flex flex-col gap-3 p-4">
        {page.reports.some(report => report.closed) && (
          <Notice tone="negative"><span data-testid="closed-alert">A report is closed: its Dive changed and no longer shows each person only their stores, so Dash won't open it for anyone. See below.</span></Notice>
        )}
        <div className="flex flex-wrap items-center gap-3" data-testid="catalogue-toolbar">
          <SearchInput aria-label="Find a report" className="min-w-56 max-w-sm flex-1" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a report" data-testid="catalogue-search" />
          {/* Counts over every report, so the row holds steady while someone searches (verifier r7). */}
          <AreaBar counts={areaCounts(page.reports)} total={page.reports.length} area={area} onChange={onArea} label="Reports by area" />
        </div>
        {page.reports.length === 0
          ? <EmptyState title="No report yet" body="Every report in Dash is a MotherDuck Dive. Add one to give it to people." action={<Button data-action variant="primary" onClick={onAddDive}>Add a Dive</Button>} />
          : shown.length === 0 && (
            <div data-testid="catalogue-none">
              <EmptyState title={area ? `No ${area} report matches that` : 'No report matches that'} body="Try fewer words, another area, or add the Dive it should come from."
                action={<span className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => { setSearch(''); onArea(null) }} data-testid="catalogue-clear">Clear search and area</Button>
                  <Button data-action variant="primary" onClick={onAddDive}>Add a Dive</Button>
                </span>} />
            </div>
          )}
        {shown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-control" data-testid={view === 'list' ? 'catalogue-list' : 'catalogue-folders'}>
              {head}
              {groups.map(group => (
                <tbody key={group.title ?? 'all'} data-testid={group.title ? 'area-folder' : undefined} data-area={group.title ?? undefined}>
                  {group.title && <tr className="bg-subtle"><th colSpan={6} className="px-2 py-2 text-start text-sm font-semibold">{group.title} <span className="font-normal text-ink-muted">· {plural(group.rows.length, 'report')}</span></th></tr>}
                  {group.rows.flatMap(renderRows)}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

/** #1217: a Team Report Manager's page: their team only, no roles, jobs, bundle tools or waiting list. */
function TeamAccess({ page, onChanged }: { page: Page; onChanged: () => Promise<unknown> }) {
  const [layout, setLayout] = useState<PickerLayout>(startPickerLayout)
  // A remove starts the Give bar afresh, so its last "is given" message doesn't outlive the row.
  const [removals, setRemovals] = useState(0)
  const [section, setSection] = useState<'who' | 'lookup'>('who')
  const [giving, setGiving] = useState(0)
  const team = page.team ?? []
  if (prototyping()) return (
    // #1225: the team page in the same anatomy as the company page (UI spec 1, item 17): only
    // the tabs a Team Report Manager can use; Give a report the one primary action.
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="fd-title">Report access</h1>
          <Button variant="primary" icon={<UserRound aria-hidden size={18} />} onClick={() => setGiving(n => n + 1)} data-testid="open-give">Give a report</Button>
        </div>
        <TeamNote team={team} />
        <details className="text-sm text-ink-muted" data-testid="how-access-works">
          <summary className="w-fit cursor-pointer">How access works</summary>
          <p className="mt-1 max-w-[70ch]">You can give the people who report to you any report you can open yourself. What a report shows them still follows their own job.</p>
        </details>
      </div>
      {giving > 0 && <GiveBar key={`${removals}-${giving}`} page={page} onGiven={onChanged} team={{ members: team, layout }} onClose={() => setGiving(0)} />}
      <div className="flex flex-col gap-4" data-testid="layout-tabs">
        <div role="tablist" aria-label="Report access" className="flex flex-wrap items-center gap-x-4 border-b border-border">
          {([['who', 'Who has what', page.rows.length], ['lookup', 'Look up a person', undefined]] as const).map(([id, label, count]) => (
            <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)} data-testid={`tab-${id}`}
              className={`inline-flex min-h-control shrink-0 items-center gap-2 border-b-2 px-1 py-2 text-control font-semibold ${section === id ? 'border-action text-action' : 'border-transparent text-ink-muted hover:text-ink'}`}>
              {label}{count !== undefined && <span className={`rounded-full px-2 text-xs ${section === id ? 'bg-action-tint text-action' : 'bg-subtle text-ink-muted'}`}>{count}</span>}
            </button>
          ))}
          <Menu label="View" className="ms-auto" testid="view-menu" trigger={<>View<ChevronDown aria-hidden size={16} /></>}
            triggerClassName="inline-flex min-h-control items-center gap-1 rounded-control px-2 text-control font-medium text-ink-muted hover:bg-subtle hover:text-ink"
            items={[
              { heading: 'Choose people by' },
              { label: 'Team list', checked: layout === 'list', onSelect: () => { keepPickerLayout('list'); setLayout('list') } },
              { label: 'Name or code', checked: layout === 'search', onSelect: () => { keepPickerLayout('search'); setLayout('search') } },
            ]} />
        </div>
        <div role="tabpanel" className="min-w-0">
          {section === 'who'
            ? <WhoHasWhat rows={page.rows} onRemoved={() => { setRemovals(n => n + 1); return onChanged() }} onGive={() => setGiving(n => n + 1)} empty="Give one to someone in your team, and it shows here." />
            : <PersonLookup team={{ members: team, layout }} />}
        </div>
      </div>
    </>
  )
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TeamNote team={team} />
        <PickerToggle value={layout} onChange={setLayout} />
      </div>
      <GiveBar key={removals} page={page} onGiven={onChanged} team={{ members: team, layout }} />
      <WhoHasWhat rows={page.rows} onRemoved={() => { setRemovals(n => n + 1); return onChanged() }} empty="Nobody in your team has a report given to them as a person yet." />
      <PersonLookup team={{ members: team, layout }} />
    </>
  )
}
type TeamPicking = { members: TeamMember[]; layout: PickerLayout }

/** "Give [report or bundle] to [person, role or job]"; to a person in their team only, for a Team Report Manager. */
function GiveBar({ page, onGiven, team, start = '', startPerson = null, onClose }: { page: Page; onGiven: () => Promise<unknown>; team?: TeamPicking; start?: string; startPerson?: Found | null; onClose?: () => void }) {
  const [gives, setGives] = useState(start)
  const [kind, setKind] = useState<Kind>('Person')
  const [receiver, setReceiver] = useState('')
  const [person, setPerson] = useState<Found | null>(startPerson)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const chosenName = () => {
    const [what, id] = gives.split(':')
    return what === 'report' ? page.reports.find(r => r.key === id)?.name : page.bundles.find(b => b.id === id)?.name
  }
  async function give() {
    const to = kind === 'Person' ? person?.person : receiver
    if (!gives) return setError('Choose a report or a bundle')
    if (!to) return setError(kind === 'Person' ? 'Find the person' : `Choose a ${kind.toLowerCase()}`)
    const [what, id] = gives.split(':')
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await act('give_report', { [what === 'report' ? 'report' : 'report_bundle']: id, [kind.toLowerCase()]: to })
      setDone(`${chosenName()} is given to ${kind === 'Person' && person ? personWithCode(person.name, person) : receiver}.`)
      setReceiver('')
      setPerson(null)
      await onGiven()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Give a report" data-testid="give-bar" actions={onClose && <Button variant="quiet" onClick={onClose} data-testid="close-give">Close</Button>}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Give" className="min-w-64 flex-1">
            <Select value={gives} onChange={event => setGives(event.target.value)} data-testid="give-what">
              <option value="">{page.bundles.length ? 'Choose a report or a bundle' : 'Choose a report'}</option>
              <optgroup label="Reports">
                {page.reports.map(report => <option key={report.key} value={`report:${report.key}`}>{report.name} · Report</option>)}
              </optgroup>
              {page.bundles.length > 0 && (
                <optgroup label="Bundles">
                  {page.bundles.map(bundle => <option key={bundle.id} value={`bundle:${bundle.id}`}>{bundle.name} · Bundle</option>)}
                </optgroup>
              )}
            </Select>
          </Field>
          {!team && <Field label="To" className="w-40">
            <Select value={kind} onChange={event => { setKind(event.target.value as Kind); setReceiver(''); setPerson(null) }} data-testid="give-kind">
              <option value="Person">A person</option>
              <option value="Role">A role</option>
              <option value="Job">A job</option>
            </Select>
          </Field>}
          {kind === 'Person' && (team?.layout === 'list'
            ? <TeamSelect team={team.members} chosen={person} onChoose={setPerson} label="To someone in your team" />
            : <PersonPicker chosen={person} onChoose={setPerson} label={team ? 'To someone in your team' : 'Person'} nobody={team ? 'No one in your team matches that' : undefined} />)}
          {kind === 'Role' && (
            <Field label="Role" className="min-w-56 flex-1">
              <Select value={receiver} onChange={event => setReceiver(event.target.value)} data-testid="give-role">
                <option value="">Choose a role</option>
                {page.roles.map(role => <option key={role} value={role}>{role} · Role</option>)}
              </Select>
            </Field>
          )}
          {kind === 'Job' && (
            <Field label="Job" className="min-w-56 flex-1">
              <Select value={receiver} onChange={event => setReceiver(event.target.value)} data-testid="give-job">
                <option value="">Choose a job</option>
                {page.jobs.map(job => <option key={job} value={job}>{job} · Job</option>)}
              </Select>
            </Field>
          )}
          <Button data-action variant="primary" loading={busy} onClick={give} data-testid="give-button">Give</Button>
        </div>
        {error && <Notice tone="negative"><span data-testid="give-error">{error}</span></Notice>}
        {done && <Notice tone="positive"><span data-testid="give-done">{done}</span></Notice>}
      </div>
    </Card>
  )
}

/** Finds a person on the staff list by name. */
export function PersonPicker({ chosen, onChoose, label, nobody = 'No one on the staff list matches that' }: { chosen: Found | null; onChoose: (found: Found | null) => void; label: string; nobody?: string }) {
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  useEffect(() => {
    const q = typed.trim()
    if (q.length < 2) { setFound(null); return }
    let live = true
    const timer = setTimeout(() => { read<Found[]>('person_search', { q }).then(answer => { if (live) setFound(answer) }, () => { if (live) setFound([]) }) }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [typed])
  if (chosen)
    return (
      <div className="flex min-w-56 flex-1 flex-col">
        <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
        <div className="flex min-h-control items-center gap-2" data-testid="person-chosen">
          <PersonName name={chosen.name} who={chosen} id={chosen.person} strong /><KindTag>Person</KindTag>
          <Button variant="quiet" onClick={() => { onChoose(null); setTyped('') }}>Change</Button>
        </div>
      </div>
    )
  return (
    <div className="relative min-w-56 flex-1">
      <Field label={label}>
        <SearchInput value={typed} onChange={event => setTyped(event.target.value)} placeholder="Type a name or employee code" data-testid="person-search" />
      </Field>
      {found && (
        <ul className="absolute z-10 mt-1 w-full rounded-control border border-border bg-surface shadow-sm" data-testid="person-results">
          {found.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">{nobody}</li>}
          {found.map(person => (
            <li key={person.person}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-subtle" onClick={() => { onChoose(person); setTyped('') }} data-testid="person-result">
                <span className="min-w-0 flex-1"><PersonName name={person.name} who={person} /></span><KindTag>Person</KindTag>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Who has what: the person, role or job first, what they have, who gave it and when; take it away after a confirmation naming what goes. */
function WhoHasWhat({ rows, onRemoved, empty, onGive, only, onClearOnly }: { rows: Row[]; onRemoved: () => Promise<unknown>; empty?: string
  /** #1225: the list's add action, in its header. */
  onGive?: () => void
  /** #1225: narrowed to one report (directly or through a bundle it is in), from the Reports tab. */
  only?: { key: string; name: string; bundles: string[] } | null
  onClearOnly?: () => void }) {
  const toast = useToast()
  const [confirming, setConfirming] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function remove(row: Row) {
    setBusy(true)
    setError(null)
    try {
      await act('remove_report_access', { id: row.id, updated_at: row.updated_at })
      setConfirming(null)
      await onRemoved()
      toast({ tone: 'positive', message: <span data-testid="taken-away">{row.gives.name} is taken away from {personWithCode(row.to.name, row.to.who)}.</span> })
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  const shown = only ? rows.filter(row => (row.gives.kind === 'Report' && row.gives.name === only.name) || (row.gives.kind === 'Bundle' && only.bundles.includes(row.gives.name))) : rows
  const th = 'py-2 pe-3 text-start text-[13px] font-medium text-ink-muted'
  return (
    <Card title={<span>Who has what <span className="font-normal text-ink-muted">{shown.length}</span></span>} data-testid="who-has-what"
      actions={onGive && <Button icon={<UserRound aria-hidden size={18} />} onClick={onGive} data-testid="who-give">Give a report</Button>}>
      <div className="flex flex-col gap-3 p-4">
        {only && (
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="who-only">
            <span className="rounded-full border border-action bg-action-tint px-3 py-1 font-medium text-action">Report: {only.name}</span>
            <button type="button" className="font-medium text-action hover:underline" onClick={onClearOnly} data-testid="who-only-clear">Clear filters</button>
          </div>
        )}
        {error && <Notice tone="negative">{error}</Notice>}
        {shown.length === 0
          ? <EmptyState title={only ? `Nobody has ${only.name} yet` : 'Nobody has a report yet'} body={empty ?? 'Give one, and it shows here with who gave it.'} action={onGive && <Button data-action variant="primary" onClick={onGive}>Give a report</Button>} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-control">
                <caption className="sr-only">Who has what</caption>
                <thead><tr className="border-b border-border"><th className={th}>Who</th><th className={th}>Has</th><th className={th}>Given by</th><th className={th}>On</th><th className="py-2"><span className="sr-only">Take away</span></th></tr></thead>
                <tbody>
                  {shown.map(row => (
                    <tr key={row.id} className="border-b border-border align-top" data-testid="access-row">
                      <td className="py-3 pe-3"><span className="inline-flex items-start gap-2"><Receiver to={row.to} /><KindTag>{row.to.kind}</KindTag></span></td>
                      <td className="py-3 pe-3"><span className="inline-flex items-center gap-2"><RecordLink table={KIND_OF[row.gives.kind]} id={row.gives.id} className="font-medium">{row.gives.name}</RecordLink>{row.gives.kind === 'Bundle' && <KindTag>Bundle</KindTag>}</span></td>
                      <td className="py-3 pe-3"><RecordLink table={RECORD.employee} id={row.given_by_id}>{row.given_by}</RecordLink></td>
                      <td className="whitespace-nowrap py-3 pe-3 text-ink-muted">{row.given_on ? dayOf(row.given_on) : '—'}</td>
                      <td className="py-2 text-end">
                        {confirming?.id === row.id ? (
                          <span className="inline-flex flex-wrap items-center justify-end gap-2" data-testid="remove-confirm">
                            <span className="text-sm">Take {row.gives.name} away from {personWithCode(row.to.name, row.to.who)}?</span>
                            <Button data-action variant="danger" loading={busy} onClick={() => void remove(row)} data-testid="remove-yes">Take away</Button>
                            <Button variant="quiet" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
                          </span>
                        ) : row.removable === false ? <span className="text-sm text-ink-muted" data-testid="not-yours">Not given by you</span>
                          // One action on the row: a quiet icon that turns negative on hover (UI standard §5).
                          : <button data-action type="button" className={iconButtonClasses('hover:text-negative')} aria-label={`Take ${row.gives.name} away from ${personWithCode(row.to.name, row.to.who)}`} title="Take it away" onClick={() => { setError(null); setConfirming(row) }} data-testid="remove"><X aria-hidden size={18} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </Card>
  )
}

/** What one person sees, and why. */
function PersonLookup({ team }: { team?: TeamPicking } = {}) {
  const [person, setPerson] = useState<Found | null>(null)
  const [answer, setAnswer] = useState<Lookup | null>(null)
  const [error, setError] = useState<string | null>(null)
  // #1222: a View As Tester can go straight to what this person sees.
  const [canViewAs, setCanViewAs] = useState(false)
  useEffect(() => { let live = true; void mayViewAs().then(may => { if (live) setCanViewAs(may) }); return () => { live = false } }, [])
  useEffect(() => {
    setAnswer(null)
    setError(null)
    if (!person) return
    let live = true
    read<Lookup>('person_lookup', { person: person.person }).then(found => { if (live) setAnswer(found) }, failure => { if (live) setError(messageOf(failure)) })
    return () => { live = false }
  }, [person])
  return (
    <Card title="What a person sees" data-testid="person-lookup">
      <div className="flex flex-col gap-3 p-4">
        {!person && <p className="text-sm text-ink-muted" data-testid="lookup-hint">Pick someone to see every report they can open, and why.</p>}
        <div className="flex flex-wrap items-end gap-3">{team?.layout === 'list'
          ? <TeamSelect team={team.members} chosen={person} onChoose={setPerson} label="Look up someone in your team" />
          : <PersonPicker chosen={person} onChoose={setPerson} label={team ? 'Look up someone in your team' : 'Look up a person'} nobody={team ? 'No one in your team matches that' : undefined} />}</div>
        {error && <Notice tone="negative">{error}</Notice>}
        {answer && answer.reports.length === 0 && <p data-testid="lookup-none">{answer.name} sees no report. Nothing has been given to them, their roles or their job.</p>}
        {answer && answer.reports.length > 0 && <p className="font-semibold" data-testid="lookup-count">{answer.name} can open {answer.reports.length} report{answer.reports.length === 1 ? '' : 's'}</p>}
        {answer && person && canViewAs && (
          <div><Button variant="secondary" data-testid="lookup-view-as" onClick={() => void startViewAs(person.person, answer.name).catch(failure => setError(messageOf(failure)))}>View as {answer.name}</Button></div>
        )}
        {answer && answer.reports.length > 0 && (
          <ul className="flex flex-col divide-y divide-border" data-testid="lookup-reports">
            {answer.reports.map(report => (
              <li key={report.key} className="py-2" data-testid="lookup-report">
                <p className="font-semibold"><RecordLink table={RECORD.report} id={report.key}>{report.name}</RecordLink></p>
                {report.closed && <p className="text-sm text-negative" data-testid="lookup-closed">{report.closed}</p>}
                <p className="text-sm text-ink-muted">{report.because.join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

/**
 * The bundles and their reports, made and changed here: a Report Access Manager can't open the
 * Admin pages. Taking a report out names it first, as Remove does above.
 */
function Bundles({ page, onChanged, onNew, area, onArea }: { page: Page; onChanged: () => Promise<unknown>
  /** #1225: the page's area; a bundle is in an area when a report in it is. Left out on today's page. */
  area?: Area | null; onArea?: (area: Area | null) => void
  /** #1225: New bundle in the card's header; without it (today's page) the form sits at the bottom. */
  onNew?: () => void }) {
  const [name, setName] = useState('')
  const [adding, setAdding] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(action: string, payload: Record<string, unknown>, after: () => void) {
    setBusy(true)
    setError(null)
    try {
      await act(action, payload)
      after()
      await onChanged()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Bundles" data-testid="bundles" actions={onNew && <Button data-action onClick={onNew} data-testid="bundles-new">New bundle</Button>}>
      <div className="flex flex-col gap-3 p-4">
        {error && <Notice tone="negative">{error}</Notice>}
        {page.bundles.length === 0 && <p className="fd-muted">No bundles yet. A bundle gives several reports at once.</p>}
        {onArea && page.bundles.length > 0 && (() => {
          const tagged = page.bundles.map(bundle => ({ name: bundle.name, areas: bundleAreas(bundle.reports.map(held => held.key), page.reports) }))
          const counts = AREAS.map(each => ({ area: each, count: tagged.filter(bundle => bundle.areas.includes(each)).length })).filter(row => row.count > 0)
          return <AreaBar counts={counts} total={page.bundles.length} area={area ?? null} onChange={onArea} label="Bundles by area" />
        })()}
        {page.bundles.filter(bundle => !onArea || !area || bundleAreas(bundle.reports.map(held => held.key), page.reports).includes(area)).map(bundle => {
          const missing = page.reports.filter(report => !bundle.reports.some(held => held.key === report.key))
          return (
            <div key={bundle.id} className={onNew ? 'flex flex-col gap-2 rounded-control border border-border p-3' : 'flex flex-col gap-2 border-b border-border pb-3'} data-testid="bundle" data-bundle-id={bundle.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex flex-wrap items-center gap-2 font-semibold"><RecordLink table={RECORD.bundle} id={bundle.id}>{bundle.name}</RecordLink>{onArea && <AreaLabels areas={bundleAreas(bundle.reports.map(held => held.key), page.reports)} />}
                <span className="text-sm font-normal text-ink-muted">{bundle.reports.length} report{bundle.reports.length === 1 ? '' : 's'}</span></p>
              {missing.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Field label={onNew ? undefined : `Add a report to ${bundle.name}`}>
                    <Select aria-label={`Add a report to ${bundle.name}`} value={adding[bundle.id] ?? ''} onChange={event => setAdding({ ...adding, [bundle.id]: event.target.value })} data-testid="bundle-add-choice">
                      <option value="">{onNew ? 'Add a report…' : 'Choose a report'}</option>
                      {missing.map(report => <option key={report.key} value={report.key}>{report.name}</option>)}
                    </Select>
                  </Field>
                  <Button data-action disabled={busy || !adding[bundle.id]} onClick={() => void run('add_to_bundle', { bundle: bundle.id, report: adding[bundle.id] }, () => setAdding({ ...adding, [bundle.id]: '' }))} data-testid="bundle-add">Add</Button>
                </div>
              )}
              </div>
              {bundle.reports.length === 0 && <p className="fd-muted text-sm">No reports in it yet.</p>}
              <ul className="flex flex-col gap-1">
                {bundle.reports.map(held => (
                  <li key={held.member} className="flex flex-wrap items-center justify-between gap-2 rounded-control px-2 hover:bg-subtle" data-testid="bundle-report">
                    <RecordLink table={RECORD.report} id={held.key}>{held.name}</RecordLink>
                    {confirming === held.member ? (
                      <span className="inline-flex flex-wrap items-center gap-2" data-testid="take-out-confirm">
                        <span className="text-sm">Take {held.name} out of {bundle.name}?</span>
                        <Button data-action variant="danger" loading={busy} onClick={() => void run('remove_from_bundle', { id: held.member, updated_at: held.updated_at }, () => setConfirming(null))} data-testid="take-out-yes">Take out</Button>
                        <Button variant="quiet" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
                      </span>
                    ) : <button data-action type="button" className={iconButtonClasses('hover:text-negative')} aria-label={`Take ${held.name} out of ${bundle.name}`} title="Take it out of the bundle" onClick={() => { setError(null); setConfirming(held.member) }} data-testid="take-out"><X aria-hidden size={16} /></button>}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {!onNew && <div className="flex flex-wrap items-end gap-2">
          <Field label="New bundle">
            <TextInput value={name} onChange={event => setName(event.target.value)} placeholder="For example, Team leader pack" data-testid="bundle-name" />
          </Field>
          <Button data-action disabled={busy || !name.trim()} onClick={() => void run('make_bundle', { name: name.trim() }, () => setName(''))} data-testid="bundle-make">Make bundle</Button>
        </div>}
      </div>
    </Card>
  )
}

/**
 * #1225: the bundles as cards (UI standard): each bundle's areas, how many reports and who has it,
 * "+ Add report" as a picker and its reports as chips; taking one out is undone from the toast.
 */
function BundleCards({ page, rows, onChanged, onNew, area, onArea, onGiveBundle }: { page: Page; rows: Row[]; onChanged: () => Promise<unknown>
  onNew: () => void; area: Area | null; onArea: (area: Area | null) => void; onGiveBundle: (id: string) => void }) {
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  async function run(action: string, payload: Record<string, unknown>) {
    setError(null)
    try {
      await act(action, payload)
      await onChanged()
      return true
    } catch (failure) {
      setError(messageOf(failure))
      return false
    }
  }
  async function takeOut(bundle: Page['bundles'][number], held: Page['bundles'][number]['reports'][number]) {
    if (!await run('remove_from_bundle', { id: held.member, updated_at: held.updated_at })) return
    toast({ tone: 'positive', message: (
      <span className="flex flex-wrap items-center gap-2" data-testid="took-out">
        {held.name} is out of {bundle.name}.
        <Button data-action variant="quiet" onClick={() => void run('add_to_bundle', { bundle: bundle.id, report: held.key })} data-testid="undo-take-out">Undo</Button>
      </span>
    ) })
  }
  const areasOfBundle = (bundle: Page['bundles'][number]) => bundleAreas(bundle.reports.map(held => held.key), page.reports)
  const counts = AREAS.map(each => ({ area: each, count: page.bundles.filter(bundle => areasOfBundle(bundle).includes(each)).length })).filter(row => row.count > 0)
  const shown = page.bundles.filter(bundle => !area || areasOfBundle(bundle).includes(area))
  return (
    <Card title={<span>Bundles <span className="font-normal text-ink-muted">{page.bundles.length}</span></span>} data-testid="bundles"
      actions={<Button icon={<Plus aria-hidden size={18} />} onClick={onNew} data-testid="bundles-new">New bundle</Button>}>
      <div className="flex flex-col gap-3 p-4">
        {error && <Notice tone="negative">{error}</Notice>}
        {page.bundles.length === 0
          ? <EmptyState title="No bundles yet" body="A bundle gives several reports at once, for example everything a team leader needs." action={<Button data-action variant="primary" onClick={onNew}>New bundle</Button>} />
          : <AreaBar counts={counts} total={page.bundles.length} area={area} onChange={onArea} label="Bundles by area" />}
        {shown.map(bundle => {
          const missing = page.reports.filter(report => !bundle.reports.some(held => held.key === report.key))
          const givenTo = rows.filter(row => row.gives.kind === 'Bundle' && row.gives.name === bundle.name).length
          return (
            <section key={bundle.id} className="flex flex-col gap-3 rounded-card border border-border p-4" data-testid="bundle" data-bundle-id={bundle.id} aria-label={bundle.name}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <RecordLink table={RECORD.bundle} id={bundle.id} className="font-semibold">{bundle.name}</RecordLink>
                <span className="flex flex-wrap gap-1"><AreaLabels areas={areasOfBundle(bundle)} /></span>
                <span className="text-sm text-ink-muted" data-testid="bundle-counts">{bundle.reports.length} report{bundle.reports.length === 1 ? '' : 's'} · given to {givenTo}</span>
                <span className="ms-auto flex items-center gap-1">
                  {missing.length > 0 && (
                    <Menu label={`Add a report to ${bundle.name}`} testid="bundle-add" trigger={<><Plus aria-hidden size={16} />Add report</>}
                      triggerClassName="inline-flex min-h-control items-center gap-1 rounded-control px-2 text-control font-medium text-action hover:bg-subtle"
                      items={missing.map(report => ({ label: report.name, testid: 'bundle-add-choice', onSelect: () => void run('add_to_bundle', { bundle: bundle.id, report: report.key }).then(done => { if (done) toast({ tone: 'positive', message: <span data-testid="bundle-added">{report.name} is in {bundle.name}.</span> }) }) }))} />
                  )}
                  <Menu label={`More for ${bundle.name}`} testid="bundle-more" trigger={<span aria-hidden className="px-1 text-lg leading-none">⋯</span>} triggerClassName={iconButtonClasses()}
                    items={[{ label: 'Give this bundle', onSelect: () => onGiveBundle(bundle.id), testid: 'bundle-give' }]} />
                </span>
              </div>
              {bundle.reports.length === 0
                ? <p className="text-sm text-ink-muted">No reports in it yet. Use Add report.</p>
                : (
                  <ul className="flex flex-wrap gap-2">
                    {bundle.reports.map(held => (
                      <li key={held.member} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface ps-3 pe-1 text-sm" data-testid="bundle-report">
                        <RecordLink table={RECORD.report} id={held.key}>{held.name}</RecordLink>
                        <button data-action type="button" className="inline-flex size-6 items-center justify-center rounded-full text-ink-muted hover:bg-subtle hover:text-negative" aria-label={`Take ${held.name} out of ${bundle.name}`} title="Take it out (you can undo)" onClick={() => void takeOut(bundle, held)} data-testid="take-out"><X aria-hidden size={14} /></button>
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          )
        })}
      </div>
    </Card>
  )
}

/** #1225: New bundle, opened from the top of the page: a name and, at once, the reports in it. */
function NewBundle({ page, onClose, onMade }: { page: Page; onClose: () => void; onMade: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<string | null>(null)
  async function make() {
    setBusy(true)
    setError(null)
    try {
      const answer = await act<{ id?: string } | undefined>('make_bundle', { name: name.trim() })
      const id = answer?.id
      if (id) for (const report of chosen) await act('add_to_bundle', { bundle: id, report })
      await onMade()
      setMade(`${name.trim()} is made${id && chosen.length ? `, with ${chosen.length} report${chosen.length === 1 ? '' : 's'} in it` : ''}. Give it with Give a report.`)
      setName('')
      setChosen([])
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="New bundle" data-testid="new-bundle" actions={<Button variant="quiet" onClick={onClose} data-testid="close-new-bundle">Close</Button>}>
      <div className="flex flex-col gap-3 p-4">
        <p className="fd-muted text-sm">A bundle gives several reports at once, for example everything a team leader needs.</p>
        {made && <Notice tone="positive"><span data-testid="bundle-made">{made}</span></Notice>}
        <Field label="Its name">
          <TextInput value={name} onChange={event => setName(event.target.value)} placeholder="For example, Team leader pack" data-testid="new-bundle-name" />
        </Field>
        <fieldset className="flex flex-col gap-1" data-testid="new-bundle-reports">
          <legend className="mb-1 text-sm font-semibold">Reports in it (you can add more later)</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {page.reports.map(report => (
              <label key={report.key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={chosen.includes(report.key)}
                  onChange={event => setChosen(event.target.checked ? [...chosen, report.key] : chosen.filter(key => key !== report.key))} />
                <span>{report.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && <Notice tone="negative">{error}</Notice>}
        <div><Button data-action variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void make()} data-testid="new-bundle-make">Make the bundle</Button></div>
      </div>
    </Card>
  )
}

/** How many Dives the card lists before Show more. */
const DIVES_SHOWN = 25

/**
 * Add a Dive (#1169): any of the organisation's Dives becomes a report taking no filter, which
 * then shows in Give and in every bundle's list above. A pasted link or id finds its Dive.
 */
function AddDive({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const [choices, setChoices] = useState<{ dives: DiveChoice[] } | { unreachable: true } | undefined>()
  const [failed, setFailed] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(DIVES_SHOWN)
  const [chosen, setChosen] = useState<DiveChoice | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const loadDives = useCallback(() => {
    setFailed(null)
    setChoices(undefined)
    return read<{ dives: DiveChoice[] } | { unreachable: true }>('dive_choices').then(setChoices, failure => setFailed(messageOf(failure)))
  }, [])
  useEffect(() => { void loadDives() }, [loadDives])
  const dives = choices && 'dives' in choices ? choices.dives : null
  const found = dives ? matchingDives(dives, search) : []
  function choose(dive: DiveChoice) {
    setChosen(dive)
    setName(dive.title)
    setError(null)
    setAdded(null)
  }
  async function add() {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      const answer = await act<{ name: string }>('add_report', { dive_id: chosen.dive_id, name: name.trim() })
      setChosen(null)
      setSearch('')
      // Said once the pickers above hold it, so the notice never points at a list without it.
      await Promise.all([onAdded(), loadDives()])
      setAdded(answer.name)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  const pastedId = diveIdIn(search)
  return (
    <Card title="Add a Dive" data-testid="add-dive">
      <div className="flex flex-col gap-3 p-4">
        <p className="fd-muted">Any Dive in MotherDuck can become a report here. Once added, give it or put it in a bundle above.</p>
        {added && <Notice tone="positive"><span data-testid="dive-added">{added} is in Dash. Give it or put it in a bundle above.</span></Notice>}
        {!choices && !failed && <Skeleton label="Reading the Dives in MotherDuck" lines={4} />}
        {(failed || (choices && 'unreachable' in choices)) && (
          <div className="flex flex-wrap items-center gap-3" data-testid="dives-unreachable">
            <Notice tone="negative">{failed ?? "Dash couldn't reach MotherDuck to list the Dives."}</Notice>
            {!failed?.startsWith('Only a Report Access Manager') && <Button onClick={() => void loadDives()}>Try again</Button>}
          </div>
        )}
        {dives && (
          <>
            <Field label="Find a Dive: type part of its title or owner, or paste its link">
              <SearchInput value={search} onChange={event => { setSearch(event.target.value); setShown(DIVES_SHOWN) }} placeholder="For example, Women Buyers, or https://app.motherduck.com/dives/…" data-testid="dive-search" />
            </Field>
            {found.length === 0 && (
              <p className="fd-muted" data-testid="dives-none">
                {pastedId ? "Dash can't see the Dive in that link. Ask its owner whether it was deleted, or made in another MotherDuck account."
                  : dives.length ? 'No Dive matches that.' : 'Dash can see no Dive in MotherDuck.'}
              </p>
            )}
            <ul className="flex flex-col divide-y divide-border">
              {found.slice(0, shown).map(dive => (
                <li key={dive.dive_id} className="flex flex-col gap-2 py-2" data-testid="dive">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">{dive.title}</span>
                      <span className="fd-muted text-sm"> · {dive.owner}{dive.saved_on ? ` · saved ${dayOf(dive.saved_on)}` : ''}</span>
                    </span>
                    {dive.in_dash ? <span className="fd-muted text-sm" data-testid="dive-in-dash">In Dash as {dive.in_dash}</span>
                      : chosen?.dive_id !== dive.dive_id && <Button data-action variant="quiet" onClick={() => choose(dive)} data-testid="dive-choose">Add</Button>}
                  </div>
                  {chosen?.dive_id === dive.dive_id && (
                    <div className="flex flex-col gap-2 rounded border border-border p-3" data-testid="dive-adding">
                      <Field label="Name in the left pane">
                        <TextInput value={name} onChange={event => setName(event.target.value)} data-testid="dive-name" />
                      </Field>
                      <p className="text-sm">Everyone you give it to sees everything the Dive shows, whatever their store.</p>
                      {error && <Notice tone="negative">{error}</Notice>}
                      <div className="flex flex-wrap gap-2">
                        <Button data-action loading={busy} disabled={!name.trim()} onClick={() => void add()} data-testid="dive-add">Add to Dash</Button>
                        <Button variant="quiet" disabled={busy} onClick={() => setChosen(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {found.length > shown && <Button variant="quiet" onClick={() => setShown(shown + DIVES_SHOWN)} data-testid="dives-more">Show more ({found.length - shown} more)</Button>}
          </>
        )}
      </div>
    </Card>
  )
}

/** People who opened Dash with no report: give them one, or (#1225, prototype) decline. */
function Waiting({ waiting, onGive, onChanged }: { waiting: Page['waiting']
  /** #1225: give this person a report, the Give form opening with them chosen. */
  onGive?: (person: Found) => void
  onChanged?: () => Promise<unknown> }) {
  const toast = useToast()
  // Decline needs a server action Dash doesn't have yet, so only the made-up prototype offers it.
  const canDecline = prototyping() && onChanged
  async function decline(w: Page['waiting'][number]) {
    await act('prototype_decline_waiting', { person: w.person })
    await onChanged!()
    toast({ tone: 'positive', message: <span data-testid="declined">{w.name} is no longer waiting. They still see no report.</span> })
  }
  return (
    <Card title={<span>Waiting for a report <span className="font-normal text-ink-muted">{waiting.length}</span></span>} data-testid="waiting">
      <ul className="flex flex-col divide-y divide-border p-4">
        {waiting.map(w => <li key={w.person} className="py-2" data-testid="waiting-person"><span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><PersonName name={w.name} who={w.who} id={w.person} />
          <span className="flex items-center gap-3"><span className="text-sm text-ink-muted">asked on {dayOf(w.asked_on)}</span>
            {canDecline && <Button data-action variant="quiet" onClick={() => void decline(w)} data-testid="waiting-decline">Decline</Button>}
            {onGive && <Button data-action variant="primary" onClick={() => onGive({ person: w.person, name: w.name, code: w.who?.code ?? null, jobs: w.who?.jobs ?? [], staff: w.who?.staff ?? 'current' })} data-testid="waiting-give">Give a report</Button>}</span></span></li>)}
      </ul>
    </Card>
  )
}
