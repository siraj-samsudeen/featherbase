import { Button } from '@featherbase/shop-floor'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { save } from './api'
import { canWorkJobs, inSite, nameOf, sitesOf, useAssets, useJobs, usePeople, usePlaces, useRestorations, type Asset, type Job, type Place } from './data'
import { JobClock } from './JobClock'
import { JobDetails, JobTimeline } from './AssetPage'
import { JOB_STAGES, coverChip, coverNotice, fixedSummary, initials, jobStage, localDay, placeName, placePath } from './jobRules'

const BOARD_STAGES = ['Reported', 'Assigned', 'In progress', 'Waiting for parts', 'Fixed', 'Closed', 'Cancelled']
/** Folded until opened, whatever they hold: the board is for work still to do. */
const FOLDED = ['Closed', 'Cancelled']
/** Closing is the store's confirmation, never a move on the board. */
const DROPPABLE = BOARD_STAGES.filter(stage => stage !== 'Closed')

type Person = { row_id: string; full_name: string }

export function JobsBoard({ roles }: { roles: string[] }) {
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const assets = useAssets()
  const places = usePlaces()
  const restorations = useRestorations()
  const canWork = canWorkJobs(roles)
  const people = usePeople()
  const [site, setSite] = useState('')
  const [opened, setOpened] = useState<string[]>([])
  const [panel, setPanel] = useState<{ job: string; fixing: boolean } | null>(null)
  const [error, setError] = useState('')
  const confirmed = new Set((restorations.data ?? []).map(r => r.job))
  const shown = (jobs.data ?? []).filter(job => !site || inSite(job.place, site, places.data))
  const today = localDay()
  const allPlaces = places.data ?? []
  const assetOf = (job: Job) => assets.data?.find(candidate => candidate.row_id === job.asset)

  const columns = BOARD_STAGES.map(stage => {
    const cards = shown.filter(job => jobStage(job, confirmed) === stage)
    const folded = (FOLDED.includes(stage) || !cards.length) && !opened.includes(stage)
    return { stage, cards, folded }
  })

  async function move(jobId: string, stage: string) {
    const job = jobs.data?.find(candidate => candidate.row_id === jobId)
    if (!job || job.job_state === stage || !DROPPABLE.includes(stage)) return
    setError('')
    // Fixed needs a note of the work done, so it opens the panel's form instead.
    if (stage === 'Fixed') { setPanel({ job: jobId, fixing: true }); return }
    try {
      await save('equipment.job', { row_id: job.row_id, updated_at: job.updated_at, job_state: stage })
      await queryClient.invalidateQueries({ queryKey: ['assets', 'jobs'] })
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not move the job') }
  }

  const dropTarget = (stage: string) => canWork && DROPPABLE.includes(stage) ? {
    onDragOver: (event: React.DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' },
    onDrop: (event: React.DragEvent) => { event.preventDefault(); void move(event.dataTransfer.getData('text/plain'), stage) },
  } : {}

  const open = panel ? jobs.data?.find(job => job.row_id === panel.job) : undefined

  return <section aria-labelledby="jobs-heading" className="jobs">
    <div className="assets-heading">
      <h1 id="jobs-heading">Repair jobs</h1>
      <label>Place<select aria-label="Place" value={site} onChange={event => setSite(event.target.value)}>
        <option value="">All sites</option>
        {sitesOf(places.data).map(p => <option key={p.row_id} value={p.row_id}>{p.place_name}</option>)}
      </select></label>
    </div>
    {jobs.error && <p role="alert">{jobs.error.message}</p>}
    {error && <p role="alert" className="counts-error">{error}</p>}
    <div className="jobs-board" style={{ gridTemplateColumns: columns.map(c => c.folded ? '36px' : 'minmax(0, 1fr)').join(' ') }}>
      {columns.map(({ stage, cards, folded }) => folded
        ? <button key={stage} type="button" className="jobs-strip" data-stage={stage} aria-label={`Show ${stage}, ${cards.length} ${cards.length === 1 ? 'job' : 'jobs'}`}
          onClick={() => setOpened([...opened, stage])} {...dropTarget(stage)}>
          <b>{cards.length}</b><span>{stage}</span>
        </button>
        : <section key={stage} aria-label={stage} className="jobs-column" data-stage={stage} {...dropTarget(stage)}>
          <h2>{stage} <span>{cards.length}</span>
            {opened.includes(stage) && (FOLDED.includes(stage) || !cards.length) &&
              <button type="button" className="jobs-fold" aria-label={`Fold ${stage}`} onClick={() => setOpened(opened.filter(s => s !== stage))}>−</button>}
          </h2>
          {cards.map(job => <JobCard key={job.row_id} job={job} stage={stage} asset={assetOf(job)} places={allPlaces} people={people.data ?? []}
            today={today} canDrag={canWork && stage !== 'Closed'} onOpen={() => setPanel({ job: job.row_id, fixing: false })} />)}
        </section>)}
    </div>
    {open && <JobPanel key={`${open.row_id}-${panel?.fixing}`} job={open} stage={jobStage(open, confirmed)} asset={assetOf(open)} places={allPlaces}
      people={people.data ?? []} today={today} canWork={canWork && jobStage(open, confirmed) !== 'Closed'} startFixing={panel?.fixing ?? false}
      onClose={() => setPanel(null)} />}
  </section>
}

function Assignee({ job, people }: { job: Job; people: Person[] }) {
  if (!job.assigned_to) return <span className="job-unassigned">Unassigned</span>
  const name = nameOf(people, job.assigned_to, 'full_name')
  return <span className="job-avatar" title={name}><span aria-hidden="true">{initials(name)}</span><span className="sr-only">Assigned to {name}</span></span>
}

function JobCard({ job, stage, asset, places, people, today, canDrag, onOpen }: {
  job: Job; stage: string; asset: Asset | undefined; places: Place[]; people: Person[]; today: string; canDrag: boolean; onOpen: () => void
}) {
  const settled = stage === 'Fixed' || stage === 'Closed'
  const cover = asset && !settled && stage !== 'Cancelled' ? coverChip(asset, today) : null
  return <article aria-label={job.problem} className="job-card" data-priority={job.priority} draggable={canDrag}
    onDragStart={canDrag ? event => { event.dataTransfer.setData('text/plain', job.row_id); event.dataTransfer.effectAllowed = 'move' } : undefined}
    onClick={event => { if (!(event.target as HTMLElement).closest('a, button')) onOpen() }}>
    <p className="job-title">{job.problem}</p>
    <p className="job-meta"><a href={`#asset=${encodeURIComponent(job.asset)}`}>{asset?.asset_name ?? job.asset}</a>
      {job.place && <> · <span title={placePath(job.place, places)}>{placeName(job.place, places)}</span></>}</p>
    {settled
      ? <p className="job-oneline" title={fixedSummary(job)}>{fixedSummary(job)}</p>
      : <ul className="job-chips" aria-label={`${job.problem} at a glance`}>
        <li className="job-chip job-priority">{job.priority}</li>
        <li><JobClock job={job} /></li>
        {cover && <li className="job-chip job-cover-chip">{cover}</li>}
      </ul>}
    <div className="job-foot">
      <Assignee job={job} people={people} />
      <button type="button" className="job-more" aria-label={`Open ${job.problem}`} onClick={onOpen}>⋯</button>
    </div>
  </article>
}

function JobPanel({ job, stage, asset, places, people, today, canWork, startFixing, onClose }: {
  job: Job; stage: string; asset: Asset | undefined; places: Place[]; people: Person[]; today: string; canWork: boolean; startFixing: boolean; onClose: () => void
}) {
  const queryClient = useQueryClient()
  const heading = useRef<HTMLHeadingElement>(null)
  const [fixing, setFixing] = useState(startFixing)
  const [workDone, setWorkDone] = useState('')
  const [cost, setCost] = useState('')
  const [cause, setCause] = useState(job.cause ?? '')
  const [spares, setSpares] = useState(job.spares ?? '')
  const [outside, setOutside] = useState(job.outside_service ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const cover = asset && stage !== 'Closed' && stage !== 'Cancelled' ? coverNotice(asset, today) : null

  useEffect(() => { heading.current?.focus() }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])

  async function update(change: Record<string, unknown>) {
    setSaving(true); setError('')
    try {
      await save('equipment.job', { row_id: job.row_id, updated_at: job.updated_at, ...change })
      setFixing(false)
      await queryClient.invalidateQueries({ queryKey: ['assets', 'jobs'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the job')
    } finally {
      setSaving(false)
    }
  }

  return <aside role="dialog" aria-label={job.problem} className="job-panel">
    <div className="job-panel-head">
      <h2 ref={heading} tabIndex={-1}>{job.problem}</h2>
      <button type="button" className="job-more" aria-label="Close" onClick={onClose}>✕</button>
    </div>
    <p className="job-meta"><a href={`#asset=${encodeURIComponent(job.asset)}`}>{asset?.asset_name ?? job.asset}</a>{job.place && ` · ${placePath(job.place, places)}`}</p>
    <p className="job-meta"><span className="job-chip job-priority">{job.priority}</span> <JobClock job={job} /> · {stage}</p>
    {cover && <p className="job-cover">{cover}</p>}
    {canWork && <div className="job-controls">
      <label>Assigned to<select aria-label={`Assign ${job.problem}`} value={job.assigned_to ?? ''} disabled={saving} onChange={event => void update({ assigned_to: event.target.value || null })}>
        <option value="">Unassigned</option>
        {people.map(person => <option key={person.row_id} value={person.row_id}>{person.full_name}</option>)}
      </select></label>
      <label>Stage<select aria-label={`Stage for ${job.problem}`} value={fixing ? 'Fixed' : job.job_state} disabled={saving} onChange={event => {
        if (event.target.value === 'Fixed') { setFixing(true); setError('') }
        else { setFixing(false); void update({ job_state: event.target.value }) }
      }}>
        {JOB_STAGES.map(option => <option key={option}>{option}</option>)}
      </select></label>
    </div>}
    {fixing && <form className="job-fix" onSubmit={event => { event.preventDefault(); void update({
      job_state: 'Fixed', work_done: workDone.trim(), repair_cost: cost === '' ? null : Number(cost),
      ...(cause.trim() ? { cause: cause.trim() } : {}), ...(spares.trim() ? { spares: spares.trim() } : {}), ...(outside.trim() ? { outside_service: outside.trim() } : {}),
    }) }}>
      <label>Work done<textarea value={workDone} onChange={event => setWorkDone(event.target.value)} rows={2} /></label>
      <label>Cause<input value={cause} onChange={event => setCause(event.target.value)} placeholder="Seal worn out" /></label>
      <label>Spares used<input value={spares} onChange={event => setSpares(event.target.value)} placeholder="Door gasket, 1 no." /></label>
      <label>Outside service<input value={outside} onChange={event => setOutside(event.target.value)} placeholder="AMC vendor, if any" /></label>
      <label>Repair cost<input type="number" min="0" step="0.01" value={cost} onChange={event => setCost(event.target.value)} /></label>
      <Button type="submit" variant="primary" disabled={saving}>Mark fixed</Button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {job.work_done && <p className="job-meta">{job.work_done}</p>}
    <JobDetails job={job} />
    <JobTimeline job={job} />
  </aside>
}
