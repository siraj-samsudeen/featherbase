// #1225: Add a Dive, a page of its own, one step at a time (UI spec "add-a-dive"): pick a Dive
// from a table, then confirm: its name, its areas, and what each person will see, which Dash
// works out from the keys the Dive reads (dive-contract.ts). A Dive that can't show each person
// only their stores gets the note for its owner and "same for everyone, for now".
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, EmptyState, Field, Notice, SearchInput, Skeleton, StatusPill, TextInput } from '@featherbase/shop-floor'
import { act, read } from './api'
import { matchingDives, type DiveChoice } from './add-dive'
import { AREAS, areasOf, type Area } from './area-tags'
import { RECORD, RecordLink } from './record-link'
import { SameForEveryone } from './pills'
import { PASSED_FILTERS, diveLink, fitOf, ownerInstruction, type Fit } from './dive-contract'

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not go through. Try again.')
const dayOf = (iso: string | null) => {
  const [y, m, d] = (iso ?? '').split('-').map(Number)
  return y && m && d ? `${String(d).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}-${y}` : ''
}
const storeAware = (fit: Fit) => fit.kind === 'stores' || fit.kind === 'one_store'
const toTop = () => { window.scrollTo(0, 0); document.body.scrollTop = 0; document.documentElement.scrollTop = 0 }

export type Added = { key: string; name: string; eachStore: boolean }

export function AddDivePage({ onAdded, onLeave }: { onAdded: () => Promise<unknown>; onLeave: (added: Added | null) => void }) {
  const [choices, setChoices] = useState<{ dives: DiveChoice[] } | { unreachable: true } | undefined>()
  const [failed, setFailed] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<DiveChoice | null>(null)
  const [removed, setRemoved] = useState<string | null>(null)
  const load = useCallback(() => {
    setFailed(null)
    setChoices(undefined)
    return read<{ dives: DiveChoice[] } | { unreachable: true }>('dive_choices').then(setChoices, failure => setFailed(messageOf(failure)))
  }, [])
  useEffect(() => { void load() }, [load])
  const dives = choices && 'dives' in choices ? choices.dives : null
  const choose = (dive: DiveChoice | null) => { setChosen(dive); setRemoved(null); toTop() }
  return (
    <div className="flex flex-col gap-4" data-testid="add-dive-page">
      <nav aria-label="Where you are" className="text-sm">
        <button type="button" className="font-medium text-action hover:underline" onClick={() => onLeave(null)} data-testid="back-to-access">Report access</button>
        <span className="text-ink-muted"> / </span>
        {chosen ? <button type="button" className="font-medium text-action hover:underline" onClick={() => choose(null)} data-testid="back-to-list">Add a Dive</button> : <span className="text-ink-muted">Add a Dive</span>}
      </nav>
      {removed && <Notice tone="positive"><span data-testid="report-removed">{removed} is no longer in Dash. Its history is kept; the Dive is still in MotherDuck and can be added again.</span></Notice>}
      {chosen
        ? <Confirm key={chosen.dive_id} dive={chosen} onCancel={() => choose(null)}
            onAdded={async added => { await onAdded(); onLeave(added) }}
            onRemoved={async name => { await Promise.all([onAdded(), load()]); setChosen(null); setRemoved(name) }} />
        : (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="fd-title">Add a Dive</h1>
              <p className="text-sm text-ink-muted">Pick a Dive from MotherDuck. Dash reads it and tells you whether it can show each person only their stores.</p>
            </div>
            <DiveTable dives={dives} failed={failed} unreachable={Boolean(choices && 'unreachable' in choices)} onRetry={() => void load()}
              search={search} onSearch={setSearch} onChoose={choose} />
          </>
        )}
    </div>
  )
}

/** What Dash found in the Dive, in the one vocabulary Dash uses everywhere. */
function ReachPill({ dive, onRetry }: { dive: DiveChoice; onRetry?: () => void }) {
  const fit = fitOf(dive.reads)
  if (storeAware(fit)) return <StatusPill tone="positive">Each person's stores</StatusPill>
  if (fit.kind === 'unknown') return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center gap-1">
        <StatusPill tone="missing">Couldn't read it</StatusPill>
        {onRetry && <Button variant="quiet" className="min-h-0 py-0" onClick={event => { event.stopPropagation(); onRetry() }} data-testid="dive-retry">Try again</Button>}
      </span>
      <span className="text-xs text-ink-muted" data-testid="dive-unread-reason">Dash couldn't read this Dive just now, so it can't tell what each person would see.</span>
    </span>
  )
  if (fit.kind === 'every_store' && !fit.ownPicker.length) return <SameForEveryone />
  return <StatusPill tone="caution">Every store</StatusPill>
}

/** The owner as a person when Dash knows who they are, else their MotherDuck account, muted. */
function Owner({ dive }: { dive: DiveChoice }) {
  return dive.owner_person ? <span>{dive.owner_person}</span> : <span className="text-ink-muted">{dive.owner}</span>
}

function DiveTable({ dives, failed, unreachable, onRetry, search, onSearch, onChoose }: {
  dives: DiveChoice[] | null; failed: string | null; unreachable: boolean; onRetry: () => void
  search: string; onSearch: (value: string) => void; onChoose: (dive: DiveChoice) => void
}) {
  const found = dives ? matchingDives(dives, search) : []
  const th = 'py-2 pe-3 text-start text-[13px] font-medium text-ink-muted'
  return (
    <Card data-testid="dive-list">
      <div className="flex flex-col gap-3 p-4">
        {!dives && !failed && !unreachable && <Skeleton label="Reading the Dives in MotherDuck" lines={6} />}
        {(failed || unreachable) && (
          <div className="flex flex-wrap items-center gap-3" data-testid="dives-unreachable">
            <Notice tone="negative">{failed ?? "Dash couldn't reach MotherDuck to list the Dives."}</Notice>
            <Button onClick={onRetry}>Try again</Button>
          </div>
        )}
        {dives && (
          <>
            <SearchInput aria-label="Find a Dive" className="max-w-xl" value={search} onChange={event => onSearch(event.target.value)} placeholder="Find a Dive by title or owner, or paste its link" data-testid="dive-search" />
            {found.length === 0
              ? <EmptyState title={dives.length ? 'No Dive matches that' : 'Dash can see no Dive in MotherDuck'} body={dives.length ? 'Try part of its title, its owner, or paste its link.' : 'Ask the Dive’s owner to share it with the organisation.'} />
              : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[48rem] text-control">
                    <thead><tr className="border-b border-border"><th className={th}>Dive</th><th className={th}>Owner</th><th className={th}>Saved</th><th className={th}>What each person sees</th><th className="py-2"><span className="sr-only">Add</span></th></tr></thead>
                    <tbody>
                      {found.map(dive => {
                        // A Dive Dash couldn't read can't be added yet; one already in Dash opens from its link.
                        const addable = !dive.in_dash && fitOf(dive.reads).kind !== 'unknown'
                        return (
                        // The whole row picks the Dive; the Add button is its keyboard way in.
                        <tr key={dive.dive_id} className={`group border-b border-border ${addable ? 'cursor-pointer hover:bg-subtle focus-within:bg-subtle' : ''}`} onClick={addable ? () => onChoose(dive) : undefined} data-testid="dive">
                          <td className="py-3 pe-3 font-medium text-ink">{dive.title}</td>
                          <td className="py-3 pe-3"><Owner dive={dive} /></td>
                          <td className="whitespace-nowrap py-3 pe-3 text-ink-muted">{dayOf(dive.saved_on) || '—'}</td>
                          <td className="py-3 pe-3">
                            {dive.in_dash
                              ? <span className="text-sm" data-testid="dive-in-dash" onClick={event => event.stopPropagation()}>In Dash as <RecordLink table={RECORD.report} id={dive.in_dash_key} className="font-medium">{dive.in_dash}</RecordLink></span>
                              : <ReachPill dive={dive} onRetry={onRetry} />}
                          </td>
                          <td className="py-2 pe-1 text-end">
                            {addable && <Button variant="quiet" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={event => { event.stopPropagation(); onChoose(dive) }} data-testid="dive-choose">Add</Button>}
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </>
        )}
      </div>
    </Card>
  )
}

/** Step 2: confirm the report: its name, its areas, and what each person sees. */
function Confirm({ dive, onAdded, onRemoved, onCancel }: { dive: DiveChoice; onAdded: (added: Added) => Promise<void>; onRemoved: (name: string) => Promise<void>; onCancel: () => void }) {
  const fit = fitOf(dive.reads)
  const link = diveLink(dive.title, dive.dive_id)
  const aware = storeAware(fit)
  const companyWide = fit.kind === 'every_store' && !fit.ownPicker.length
  const [name, setName] = useState(dive.title)
  const [areas, setAreas] = useState<Area[]>(() => areasOf(dive.title))
  const [understood, setUnderstood] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const note = ownerInstruction(dive.title, link)
  const ready = Boolean(name.trim()) && areas.length > 0 && (aware || companyWide || understood)
  async function add() {
    setBusy(true)
    setError(null)
    try {
      // The server reads the Dive again and decides the shape itself; the page only says what it saw.
      const answer = await act<{ key: string; name: string }>('add_report', { dive_id: dive.dive_id, name: name.trim(), areas, store_aware: aware, owner_asked: copied })
      await onAdded({ key: answer.key, name: answer.name, eachStore: aware })
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(note) } catch { /* the note stays on screen to copy by hand */ }
    setCopied(true)
  }
  const addButton = <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void add()} data-testid="dive-add">Add report</Button>
  if (dive.in_dash) return (
    <div className="flex max-w-[880px] flex-col gap-4">
      <h1 className="fd-title">{dive.title}</h1>
      <InDash dive={dive} onRemoved={onRemoved} />
    </div>
  )
  const readsList = fit.kind === 'stores'
    ? [['Their stores, and in each one the sections they work in', 'reach'], ...(fit.openOn ? [['The store it opens on, one of theirs', 'store']] : []), ...(fit.month ? [['The month: this month or last', 'month']] : [])]
    : fit.kind === 'one_store'
      ? [['Their store', 'plant_code'], ['The subcategories they work in there', 'material_groups'], ['Whether they see the whole store or part of it', 'whole_store'], ...(fit.month ? [['The month: this month or last', 'month']] : [])]
      : []
  return (
    <div className="flex max-w-[880px] flex-col gap-4" data-testid="dive-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="fd-title" data-testid="dive-title">Add <em className="not-italic text-ink">“{dive.title}”</em></h1>
          <p className="flex flex-wrap gap-x-2 text-sm text-ink-muted">
            <span>Owner <Owner dive={dive} /></span>· <span>saved {dayOf(dive.saved_on) || '—'}</span>· <span data-testid="dive-version">version {dive.version ?? '—'}</span>·
            <a href={link} target="_blank" rel="noopener noreferrer" className="font-medium text-action hover:underline" data-testid="dive-link">Open it in MotherDuck ↗</a>
          </p>
        </div>
        <div className="flex items-center gap-2"><Button variant="quiet" onClick={onCancel}>Cancel</Button>{addButton}</div>
      </div>
      <Card>
        <div className="flex flex-col gap-5 p-4">
          <Field label="Name">
            <TextInput value={name} onChange={event => setName(event.target.value)} data-testid="dive-name" />
          </Field>
          <fieldset className="flex flex-col gap-2" data-testid="dive-areas">
            <legend className="mb-1 text-control font-medium text-ink">Area</legend>
            <div className="flex flex-wrap gap-2">
              {AREAS.map(each => (
                <button key={each} type="button" aria-pressed={areas.includes(each)} onClick={() => setAreas(areas.includes(each) ? areas.filter(x => x !== each) : [...areas, each])} data-testid="dive-area"
                  className="min-h-8 rounded-full border border-border-control px-3 text-sm text-ink hover:bg-subtle aria-pressed:border-action aria-pressed:bg-action-tint aria-pressed:font-semibold aria-pressed:text-action">{each}</button>
              ))}
            </div>
            <p className="text-sm text-ink-muted">{areasOf(dive.title).length ? "Picked from its title. Change them if they're wrong." : 'Its title gives no area. Pick at least one so people can find it under that area.'}</p>
          </fieldset>
          <section className="flex flex-col gap-2" data-testid="decision" data-fit={fit.kind}>
            <h2 className="text-control font-medium text-ink">What each person sees</h2>
            {aware ? (
              <>
                <Notice tone="positive"><span data-testid="fit-store-aware"><b>Each person sees only their stores.</b> Dash fills these from each person's job; there is nothing to set.</span></Notice>
                <ul className="flex flex-col divide-y divide-border rounded-control border border-border" data-testid="dive-filters">
                  {readsList.map(([words, key]) => (
                    <li key={key} className="px-3 py-2 text-sm">{words}</li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <Notice tone={companyWide ? 'info' : 'caution'}>
                  <span data-testid="fit-every-store">
                    <b>{fit.kind === 'unknown' ? "Dash couldn't read this Dive." : companyWide ? 'It shows the same figures to everyone.' : 'It shows every store.'}</b>{' '}
                    {fit.kind === 'unknown' ? "Added now, everyone you give it to would see every store."
                      : fit.kind === 'partly' ? "It takes the store from Dash, but not each person's subcategories or whether they see the whole store."
                        : companyWide ? 'Right for a company-wide report. If it should show each person only their stores, ask its owner.'
                          : 'It has its own Store picker that lists every store, so anyone you give it to could pick any store.'}
                  </span>
                </Notice>
                <div className="flex flex-col gap-2 rounded-control border border-border p-3" data-testid="ask-owner">
                  <p className="text-sm"><b>Ask its owner to make it show each person only their stores.</b> Dash checks the Dive itself, when you ask it to and whenever someone opens the report, and switches over only when the Dive really does it.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => void copy()} data-testid="copy-note">{copied ? 'Copied ✓' : 'Copy the note for its owner'}</Button>
                    <details><summary className="cursor-pointer text-sm font-medium text-action">See the note</summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-subtle p-3 text-xs" data-testid="owner-note">{note}</pre></details>
                  </div>
                </div>
                {!companyWide && (
                  <label className="flex items-start gap-2 text-sm" data-testid="understood">
                    <input type="checkbox" className="mt-1" checked={understood} onChange={event => setUnderstood(event.target.checked)} />
                    <span>Add it for now: everyone I give it to sees every store until its owner changes the Dive.</span>
                  </label>
                )}
              </>
            )}
          </section>
          <details data-testid="passed-filters">
            <summary className="cursor-pointer text-sm font-medium text-ink-muted">Details: what Dash can pass to this Dive</summary>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {PASSED_FILTERS.map(filter => {
                  const reads = dive.reads ?? []
                  const ownPicker = filter.key === 'store' && reads.includes('store') && !reads.includes('reach')
                  const takes = fit.kind !== 'unknown' && reads.includes(filter.key) && !ownPicker
                  return (
                    <tr key={filter.key} className="border-b border-border" data-testid="passed-filter" data-takes={takes}>
                      <td className="py-1.5 pe-2">{filter.passes}</td><td className="py-1.5 pe-2"><code className="text-xs">{filter.key}</code></td>
                      <td className={`py-1.5 font-medium ${takes ? 'text-positive' : 'text-ink-muted'}`}>{fit.kind === 'unknown' ? '?' : takes ? '✓ Takes it' : ownPicker ? '✗ Its own picker' : '✗ No'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </details>
          {error && <Notice tone="negative">{error}</Notice>}
          <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onCancel}>Cancel</Button>{addButton}</div>
        </div>
      </Card>
    </div>
  )
}

/** #1225: a Dive already in Dash: say so, and let a Report Access Manager remove the report (a retire: history kept). */
function InDash({ dive, onRemoved }: { dive: DiveChoice; onRemoved: (name: string) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await act('retire_report', { report: dive.in_dash_key })
      await onRemoved(dive.in_dash!)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Card title="Already in Dash" data-testid="in-dash">
      <div className="flex flex-col gap-3 p-4">
        <p data-testid="already-in-dash">This Dive is already in Dash as <RecordLink table={RECORD.report} id={dive.in_dash_key} className="font-semibold">{dive.in_dash ?? ''}</RecordLink>.</p>
        {error && <Notice tone="negative">{error}</Notice>}
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-control border border-negative p-3" data-testid="remove-report-confirm">
            <span className="text-sm">Remove {dive.in_dash} from Dash? Everyone given it stops seeing it, and it leaves any bundle. Its history is kept, and the Dive stays in MotherDuck.</span>
            <Button variant="danger" loading={busy} onClick={() => void remove()} data-testid="remove-report-yes">Remove the report</Button>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : <div><Button variant="quiet" onClick={() => setConfirming(true)} data-testid="remove-report">Remove this report</Button></div>}
      </div>
    </Card>
  )
}

