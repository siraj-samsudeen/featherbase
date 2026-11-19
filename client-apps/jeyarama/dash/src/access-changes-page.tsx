// #1340: Who Would Gain Or Lose Access, answer-first (spec item 10): when it was checked, which rules decide today, the
// headline in large type, four findings that each filter the list, a card for each person who needs a decision, and
// everyone who changes as the shared list, each person a link to Explain A Person. The comparison is the server's
// (access_changes), unchanged; Let Them Lose Dash only records the owner's decision (decide_access).
import { useMemo, useState } from 'react'
import { Button, Card, DataList, FindingCard, LinkLine, LinkSection, Notice, SearchInput, Segmented, StatusPill, buttonClasses, fmtCount, fmtDateTime, type DataColumn } from '@featherbase/shop-floor'
import { act } from './api'
import { Loading, Shell } from './sections-page'
import { RecordLink } from './record-link'
import { type Who } from './person-identity'
import { Failed, Parts, PersonLink, explainAddress, messageOf, useRead, type Part } from './roles-shared'
import { ChangeFacts, accessWords, type Change, type Side } from './explain-person-page'

interface Changed extends Change {
  person: string; name: string; who: (Who & { held?: { job: string; site?: { id: string; name: string } }[] }) | null; roles: string[]
  today?: Side; next?: Side
  /** The owner has decided they are to lose Dash (Let Them Lose Dash). */
  decided?: boolean
}
/** #1277 (decision 7): an old grant Give Old Grants To Business Roles leaves where it is, and who would lose its reports. */
interface NotCarried { grant: string; gives: Part; receiver: { kind: 'job' | 'role'; name: string }; note: string; people: { person: string; name: string; reports: Part[] }[] }
interface ChangesAnswer { people: number; changed: number; groups: { kind: Change['kinds'][number]; people: Changed[] }[]; not_carried_over?: NotCarried[] }

type Finding = 'all' | 'decide' | 'loses' | 'stores' | 'reports'
const FINDING_LABEL: Record<Exclude<Finding, 'all'>, string> = { decide: 'Need A Decision', loses: 'Lose Dash', stores: 'See Different Stores', reports: 'See Different Reports' }
/** The first lines of the list before Show all. */
const SHOWN = 10

/** Needs the owner's decision before the switch: reports today only through an old role, or business roles would open Dash and nothing lets them in. */
export const needsDecision = (p: Changed) => !p.decided && (p.kinds.includes('decision') || p.kinds.includes('needs_dash_role'))
const inFinding = (finding: Finding, p: Changed) => finding === 'all' ? true : finding === 'decide' ? needsDecision(p)
  : finding === 'loses' ? p.kinds.includes('loses_dash') : finding === 'stores' ? p.kinds.includes('stores') : p.kinds.includes('reports') || p.kinds.includes('decision')

const titleOf = (p: Changed) => [...new Set((p.who?.held ?? []).map(h => h.job))].join(', ') || (p.who?.jobs?.length ? p.who.jobs.join(', ') : 'No current job')
const sitesOf = (p: Changed) => [...new Map((p.who?.held ?? []).flatMap(h => h.site ? [[h.site.id, h.site] as const] : [])).values()]
const sideWords = (side: Side | undefined) => (side ? accessWords(side) : '—')

/** The list as a CSV people open in a spreadsheet: one line per person, the reason in words. */
export function changesCsv(people: Changed[]): string {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const words = (p: Changed) => [
    p.kinds.includes('loses_dash') && 'Would lose Dash', p.kinds.includes('gains_dash') && 'Would gain Dash',
    p.stores_gained.length && `Would reach ${p.stores_gained.map(s => s.name).join(', ')}`, p.stores_lost.length && `Would stop reaching ${p.stores_lost.map(s => s.name).join(', ')}`,
    p.gained.length && `Would get ${p.gained.map(s => s.name).join(', ')}`, p.lost.length && `Would lose ${p.lost.map(s => s.name).join(', ')}`,
    p.decisions.length && `Needs a decision: ${p.decisions.map(s => s.name).join(', ')}`,
  ].filter(Boolean).join('; ')
  const rows = people.map(p => [p.name, titleOf(p), sitesOf(p).map(s => s.name).join(', '), sideWords(p.today), sideWords(p.next), needsDecision(p) ? 'Needs a decision' : 'Decided', words(p)])
  return [['Person', 'HR Title', 'Site', 'Today', 'With Business Roles', 'Decision', 'Why'], ...rows].map(r => r.map(quote).join(',')).join('\n') + '\n'
}

export function AccessChangesPage() {
  const { answer, failed, load } = useRead<ChangesAnswer>('access_changes', {})
  const source = useRead<{ source: 'business_roles' | 'legacy' }>('access_source', {})
  const [checkedAt, setCheckedAt] = useState(() => new Date())
  const again = async () => { await load(); setCheckedAt(new Date()) }
  return (
    <Shell current="changes" testid="access-changes" title="Who Would Gain Or Lose Access" wide>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-muted" data-testid="changes-checked">
          Old rules compared with business roles · checked {fmtDateTime(checkedAt)} ·{' '}
          <button type="button" onClick={again} className="font-medium text-action hover:underline" data-testid="check-again">Check again</button>
        </p>
        <span className="flex-1" />
        {source.answer?.source && (
          <StatusPill tone={source.answer.source === 'business_roles' ? 'positive' : 'missing'}>
            <span data-testid="decides-today">Today {source.answer.source === 'business_roles' ? 'business roles decide' : 'old rules decide'}</span>
          </StatusPill>
        )}
        {answer && <ExportCsv people={uniquePeople(answer)} />}
      </div>
      {!answer && !failed && <Loading />}
      {failed && <Failed message={failed} onRetry={load} />}
      {answer && <Changes answer={answer} onChanged={load} />}
    </Shell>
  )
}

/** Each changed person once, whatever groups they are under. */
const uniquePeople = (answer: ChangesAnswer) => [...new Map(answer.groups.flatMap(g => g.people).map(p => [p.person, p])).values()].sort((a, b) => a.name.localeCompare(b.name))

function ExportCsv({ people }: { people: Changed[] }) {
  const href = useMemo(() => `data:text/csv;charset=utf-8,${encodeURIComponent(changesCsv(people))}`, [people])
  return <a href={href} download="who-would-gain-or-lose-access.csv" className={buttonClasses()} data-testid="export-csv">Export CSV</a>
}

function Changes({ answer, onChanged }: { answer: ChangesAnswer; onChanged: () => Promise<unknown> }) {
  const people = uniquePeople(answer)
  const deciding = people.filter(needsDecision)
  const gains = people.filter(p => p.kinds.includes('gains_dash')).length
  const [finding, setFinding] = useState<Finding>('all')
  const [search, setSearch] = useState('')
  const [all, setAll] = useState(false)
  const [decided, setDecided] = useState<Changed | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  const undo = async () => {
    setUndoError(null)
    try { await act('decide_access', { person: decided!.person, undo: true }); setDecided(null); await onChanged() } catch (e) { setUndoError(messageOf(e)) }
  }
  const count = (f: Finding) => people.filter(p => inFinding(f, p)).length
  const toggle = (f: Finding) => { setFinding(finding === f ? 'all' : f); setAll(false) }
  const words = search.trim().toLowerCase()
  const listed = people.filter(p => inFinding(finding, p) && (!words || `${p.name} ${titleOf(p)} ${sitesOf(p).map(s => s.name).join(' ')}`.toLowerCase().includes(words)))
  const shown = all ? listed : listed.slice(0, SHOWN)
  const columns: DataColumn<Changed>[] = [
    // Two people may share a name: their staff code tells them apart.
    { key: 'person', header: 'Person', phone: 'title', cell: p => <span className="whitespace-nowrap"><PersonLink person={p.person} name={p.name} testid="changed-name" />{p.who?.code && <span className="text-ink-muted"> {p.who.code}</span>}</span> },
    { key: 'title', header: 'HR Title', phone: 'meta', cell: p => titleOf(p) },
    { key: 'site', header: 'Site', phone: 'meta', cell: p => sitesOf(p).length ? <Parts parts={sitesOf(p).map(s => ({ name: s.name, table: 'Site', id: s.id }))} /> : <span className="text-ink-subtle">—</span> },
    { key: 'today', header: 'Today', phone: 'meta', cell: p => sideWords(p.today) },
    { key: 'next', header: 'With Business Roles', phone: 'status', cell: p => (
      <span className="flex flex-wrap items-center gap-1.5">
        {p.kinds.includes('loses_dash') ? <StatusPill tone="missing">No Dash</StatusPill> : <span>{sideWords(p.next)}</span>}
        {needsDecision(p) && <StatusPill tone="caution">Needs a decision</StatusPill>}
      </span>
    ) },
    { key: 'why', header: 'Why', phone: 'meta', cell: p => <span className="text-ink-muted"><ChangeFacts change={p} decided={p.decided} /></span> },
  ]
  return (
    <div className="flex flex-col gap-6">
      {/* The answer first, in calm words on a soft fill (the mockup's line): what changes, then what remains. */}
      <section className="flex flex-col gap-1.5 rounded-card bg-subtle px-5 py-4" aria-label="The answer" data-testid="changes-answer">
        <p className="text-xl font-semibold leading-snug text-ink max-sm:text-base">
          {people.length === 0 ? `All ${counted(answer.people)} would keep exactly what they have.`
            : `${fmtCount(people.length)} of ${counted(answer.people)} would see something different. ${decidedWords(people.length, deciding.length)}`}
        </p>
        <p className="text-sm text-ink-muted" data-testid="changes-detail">{gains ? `${counted(gains)} would gain Dash.` : 'Nobody gains Dash.'} The other {fmtCount(answer.people - people.length)} keep exactly what they have.</p>
      </section>
      <div className="flex flex-wrap gap-3" data-testid="findings">
        <FindingCard count={count('decide')} title="Need A Decision" tone="caution" selected={finding === 'decide'} onSelect={() => toggle('decide')}
          reason="Reports they get today only through an old role that business roles don't give, or Dash opens with nothing to let them in" owner="Owner decides · before the switch" />
        <FindingCard count={count('loses')} title="Lose Dash" tone="quiet" selected={finding === 'loses'} onSelect={() => toggle('loses')}
          reason="People whose business roles don't open Dash" owner="Decided by the roles · no action" />
        <FindingCard count={count('stores')} title="See Different Stores" tone="neutral" selected={finding === 'stores'} onSelect={() => toggle('stores')}
          reason="Their store or section would come from their HR title" owner="Check after the switch" />
        <FindingCard count={count('reports')} title="See Different Reports" tone="neutral" selected={finding === 'reports'} onSelect={() => toggle('reports')}
          reason="A report given to a job or an old role, now given to a business role" owner="Check after the switch" />
      </div>
      <p className="-mt-3 text-[13px] text-ink-muted">Each finding filters the list below. A person with two changes counts once in the headline and shows under each finding.</p>
      {/* Kept here, not in the list: deciding the last person empties the list, and the Undo must stay (Codex round 2). */}
      {decided && (
        <Notice tone="positive">
          <span data-testid="decided">{decided.name} will lose Dash with business roles. </span>
          <button type="button" className="font-medium text-action hover:underline" onClick={undo} data-testid="undo-lose">Undo</button>
        </Notice>
      )}
      {undoError && <Notice tone="negative">{undoError}</Notice>}
      {deciding.length > 0 && <Decide people={deciding} onChanged={onChanged} onDecided={setDecided} />}
      <section className="flex flex-col gap-3" aria-label="Everyone Who Changes" data-testid="everyone">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-ink">Everyone Who Changes</h2>
          <Segmented label="Show" value={finding} onChange={(f) => { setFinding(f); setAll(false) }} options={[
            { value: 'all', label: `All ${fmtCount(people.length)}` },
            ...(['loses', 'stores', 'reports', 'decide'] as const).map(f => ({ value: f, label: `${FINDING_LABEL[f]} ${fmtCount(count(f))}` })),
          ]} />
          <span className="flex-1" />
          <div className="w-64"><SearchInput aria-label="Search people" placeholder="Search people" value={search} onChange={e => setSearch(e.target.value)} data-testid="changes-search" /></div>
        </div>
        <Card className="overflow-hidden">
          <DataList caption="Everyone who changes" rows={shown} columns={columns} rowKey={p => p.person} rowTestId={() => 'changed-person'}
            empty={{ title: 'Nobody here', body: 'No one who changes matches this filter.' }} />
        </Card>
        <p className="text-[13px] text-ink-muted" data-testid="changes-shown">
          {listed.length ? `1–${fmtCount(shown.length)} of ${fmtCount(listed.length)}` : 'None'}
          {listed.length > SHOWN && <> · <button type="button" className="font-medium text-action hover:underline" onClick={() => setAll(!all)} data-testid="changes-show-all">{all ? 'Show fewer' : `Show all ${fmtCount(listed.length)}`}</button></>}
          {' '}· every name opens Explain A Person
        </p>
      </section>
      {!!answer.not_carried_over?.length && <NotCarriedOver grants={answer.not_carried_over} />}
    </div>
  )
}

/** "All 17 changes are decided.", or "15 of the 17 changes are decided; 2 need your decision before the switch." */
export function decidedWords(changed: number, deciding: number): string {
  const changes = `${fmtCount(changed)} ${changed === 1 ? 'change' : 'changes'}`
  if (!deciding) return changed === 1 ? 'The 1 change is decided.' : `All ${changes} are decided.`
  return `${fmtCount(changed - deciding)} of the ${changes} ${changed - deciding === 1 ? 'is' : 'are'} decided; ${fmtCount(deciding)} ${deciding === 1 ? 'needs' : 'need'} your decision before the switch.`
}

const counted = (n: number) => `${fmtCount(n)} ${n === 1 ? 'person' : 'people'}`

/** One card for each person who needs a decision: what they have today and with business roles, and the two ways to settle it. */
function Decide({ people, onChanged, onDecided }: { people: Changed[]; onChanged: () => Promise<unknown>; onDecided: (p: Changed) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Letting someone lose Dash asks first, on the card; once done, the page offers Undo.
  const [asking, setAsking] = useState<string | null>(null)
  const decide = async (p: Changed) => {
    setBusy(p.person); setError(null)
    try {
      await act('decide_access', { person: p.person })
      setAsking(null)
      onDecided(p)
      await onChanged()
    } catch (e) { setError(messageOf(e)) } finally { setBusy(null) }
  }
  return (
    <section className="flex flex-col gap-3" aria-label="Need A Decision" data-testid="decide">
      <div className="flex items-baseline gap-2"><h2 className="text-base font-semibold text-ink">Need A Decision</h2><span className="text-[13px] text-ink-muted">{fmtCount(people.length)}</span></div>
      {error && <Notice tone="negative">{error}</Notice>}
      <div className="flex flex-wrap gap-3">
        {people.map(p => (
          <div key={p.person} className="flex min-w-80 flex-1 basis-80 flex-col gap-2.5 rounded-card bg-caution-tint p-4" data-testid="decide-card">
            <div className="text-sm"><PersonLink person={p.person} name={p.name} />{p.who?.code && <span className="text-ink-muted"> {p.who.code}</span>} <span className="text-ink-muted">· {titleOf(p)}{sitesOf(p).length ? <> · <Parts parts={sitesOf(p).map(s => ({ name: s.name, table: 'Site', id: s.id }))} /></> : null}</span></div>
            <p className="text-sm text-ink">Today: {sideWords(p.today)}. With business roles: {p.kinds.includes('loses_dash') ? 'no Dash' : sideWords(p.next)}. <span className="text-ink-muted"><ChangeFacts change={p} decided={p.decided} /></span></p>
            {asking === p.person ? (
              <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="lose-confirm">
                <span>Let {p.name} lose Dash with business roles?</span>
                <Button variant="primary" loading={busy === p.person} onClick={() => decide(p)} data-testid="lose-yes">Yes, Let Them Lose It</Button>
                <Button variant="quiet" onClick={() => setAsking(null)} data-testid="lose-keep">Keep Deciding</Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <a href={`${explainAddress(p.person)}&give=1`} className={buttonClasses({ variant: 'primary' })} data-testid="give-a-role">Give A Role…</a>
                <Button onClick={() => setAsking(p.person)} data-testid="let-lose">Let Them Lose Dash</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function NotCarriedOver({ grants }: { grants: NotCarried[] }) {
  return (
    <LinkSection heading="Not Carried Over" count={grants.length} testid="not-carried-over">
      <li className="px-2 text-[13px] text-ink-muted">Old grants that stay where they are and give nothing while business roles decide. Give one to a business role on request.</li>
      {grants.map(g => {
        const reports = [...new Map(g.people.flatMap(p => p.reports).map(r => [r.id, r])).values()]
        return (
          <LinkLine key={g.grant} testid="not-carried-line"
            note={<span data-testid="not-carried-people">{g.note}. {g.people.length ? <>Would lose <Parts parts={reports} />: {g.people.map((p, i) => <span key={p.person}>{i ? ', ' : ''}<PersonLink person={p.person} name={p.name} testid="not-carried-person" /></span>)}</> : 'Nobody would lose a report'}</span>}>
            <span data-testid="not-carried-grant"><RecordLink table={g.gives.table ?? 'dash.report'} id={g.gives.id}>{g.gives.name}</RecordLink> · to the {g.receiver.kind} {g.receiver.name}</span>
          </LinkLine>
        )
      })}
    </LinkSection>
  )
}
