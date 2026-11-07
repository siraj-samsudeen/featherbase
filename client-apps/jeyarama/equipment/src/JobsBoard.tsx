import { Button } from '@featherbase/shop-floor'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { save } from './api'
import { canWorkJobs, nameOf, useAssets, useJobs, usePeople, usePlaces, type Job } from './data'
import { JobClock } from './JobClock'
import { JOB_STAGES } from './jobRules'

export function JobsBoard({ roles }: { roles: string[] }) {
  const jobs = useJobs()
  const assets = useAssets()
  const places = usePlaces()
  const canWork = canWorkJobs(roles)
  const people = usePeople()
  const [place, setPlace] = useState('')
  const shown = (jobs.data ?? []).filter(job => !place || job.place === place)

  return <section aria-labelledby="jobs-heading" className="jobs">
    <div className="assets-heading">
      <h1 id="jobs-heading">Repair jobs</h1>
      <label>Place<select aria-label="Place" value={place} onChange={event => setPlace(event.target.value)}>
        <option value="">All places</option>
        {(places.data ?? []).map(p => <option key={p.row_id} value={p.row_id}>{p.place_name}</option>)}
      </select></label>
    </div>
    {jobs.error && <p role="alert">{jobs.error.message}</p>}
    <div className="jobs-board">
      {JOB_STAGES.map(stage => {
        const cards = shown.filter(job => job.job_state === stage)
        return <section key={stage} aria-label={stage} className="jobs-column" data-stage={stage}>
          <h2>{stage} <span>{cards.length}</span></h2>
          {cards.map(job => <JobCard key={job.row_id} job={job} canWork={canWork}
            assetName={nameOf(assets.data, job.asset, 'asset_name')} placeName={nameOf(places.data, job.place, 'place_name')}
            people={people.data ?? []} />)}
        </section>
      })}
    </div>
  </section>
}

function JobCard({ job, canWork, assetName, placeName, people }: {
  job: Job; canWork: boolean; assetName: string; placeName: string; people: { row_id: string; full_name: string }[]
}) {
  const queryClient = useQueryClient()
  const [fixing, setFixing] = useState(false)
  const [workDone, setWorkDone] = useState('')
  const [cost, setCost] = useState('')
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
    {fixing && <form className="job-fix" onSubmit={event => { event.preventDefault(); void update({ job_state: 'Fixed', work_done: workDone.trim(), repair_cost: cost === '' ? null : Number(cost) }) }}>
      <label>Work done<textarea value={workDone} onChange={event => setWorkDone(event.target.value)} rows={2} /></label>
      <label>Repair cost<input type="number" min="0" step="0.01" value={cost} onChange={event => setCost(event.target.value)} /></label>
      <Button type="submit" variant="primary" disabled={saving}>Mark fixed</Button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </article>
}
