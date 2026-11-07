import { Button } from '@featherbase/shop-floor'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { save } from './api'
import { canWorkJobs, inSite, nameOf, sitesOf, useAssets, useJobs, usePeople, usePlaces, useRestorations, type Job } from './data'
import { JobClock } from './JobClock'
import { JobDetails } from './AssetPage'
import { JOB_STAGES, coverNotice, jobStage, localDay, placePath } from './jobRules'

const BOARD_STAGES = ['Reported', 'Assigned', 'In progress', 'Waiting for parts', 'Fixed', 'Closed', 'Cancelled']

export function JobsBoard({ roles }: { roles: string[] }) {
  const jobs = useJobs()
  const assets = useAssets()
  const places = usePlaces()
  const restorations = useRestorations()
  const canWork = canWorkJobs(roles)
  const people = usePeople()
  const [site, setSite] = useState('')
  const confirmed = new Set((restorations.data ?? []).map(r => r.job))
  const shown = (jobs.data ?? []).filter(job => !site || inSite(job.place, site, places.data))
  const today = localDay()

  return <section aria-labelledby="jobs-heading" className="jobs">
    <div className="assets-heading">
      <h1 id="jobs-heading">Repair jobs</h1>
      <label>Place<select aria-label="Place" value={site} onChange={event => setSite(event.target.value)}>
        <option value="">All sites</option>
        {sitesOf(places.data).map(p => <option key={p.row_id} value={p.row_id}>{p.place_name}</option>)}
      </select></label>
    </div>
    {jobs.error && <p role="alert">{jobs.error.message}</p>}
    <div className="jobs-board">
      {BOARD_STAGES.map(stage => {
        const cards = shown.filter(job => jobStage(job, confirmed) === stage)
        return <section key={stage} aria-label={stage} className="jobs-column" data-stage={stage}>
          <h2>{stage} <span>{cards.length}</span></h2>
          {cards.map(job => {
            const asset = assets.data?.find(candidate => candidate.row_id === job.asset)
            return <JobCard key={job.row_id} job={job} canWork={canWork && stage !== 'Closed'}
              assetName={asset?.asset_name ?? job.asset} placeName={placePath(job.place ?? '', places.data ?? [])}
              cover={asset && stage !== 'Closed' && stage !== 'Cancelled' ? coverNotice(asset, today) : null}
              people={people.data ?? []} />
          })}
        </section>
      })}
    </div>
  </section>
}

function JobCard({ job, canWork, assetName, placeName, cover, people }: {
  job: Job; canWork: boolean; assetName: string; placeName: string; cover: string | null; people: { row_id: string; full_name: string }[]
}) {
  const queryClient = useQueryClient()
  const [fixing, setFixing] = useState(false)
  const [workDone, setWorkDone] = useState('')
  const [cost, setCost] = useState('')
  const [cause, setCause] = useState(job.cause ?? '')
  const [spares, setSpares] = useState(job.spares ?? '')
  const [outside, setOutside] = useState(job.outside_service ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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

  return <article aria-label={job.problem} className="job-card" data-priority={job.priority}>
    <p className="job-title">{job.problem}</p>
    <p className="job-meta"><a href={`#asset=${encodeURIComponent(job.asset)}`}>{assetName}</a> · {placeName}</p>
    <p className="job-meta"><span className="job-priority">{job.priority}</span> <JobClock job={job} /></p>
    {job.assigned_to && <p className="job-meta">{nameOf(people, job.assigned_to, 'full_name')}</p>}
    {job.work_done && <p className="job-meta">{job.work_done}</p>}
    <JobDetails job={job} />
    {cover && <p className="job-cover">{cover}</p>}
    {canWork && <div className="job-controls">
      <select aria-label={`Assign ${job.problem}`} value={job.assigned_to ?? ''} disabled={saving} onChange={event => void update({ assigned_to: event.target.value || null })}>
        <option value="">Unassigned</option>
        {people.map(person => <option key={person.row_id} value={person.row_id}>{person.full_name}</option>)}
      </select>
      <select aria-label={`Stage for ${job.problem}`} value={fixing ? 'Fixed' : job.job_state} disabled={saving} onChange={event => {
        if (event.target.value === 'Fixed') { setFixing(true); setError('') }
        else { setFixing(false); void update({ job_state: event.target.value }) }
      }}>
        {JOB_STAGES.map(stage => <option key={stage}>{stage}</option>)}
      </select>
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
  </article>
}
