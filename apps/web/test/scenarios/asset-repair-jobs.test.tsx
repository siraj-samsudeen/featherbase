// asset-repair-jobs's scenarios (#1070): each test is one fenced scenario of
// openspec/specs/asset-repair-jobs/spec.md, step by step, with the Assets app
// rendered in jsdom against the real in-process server. Assets stamps when a
// job was reported, responded to, started and restored from the server's own
// clock, so "at 10:00" anchors a scenario: later times are read relative to
// the stored report, and the page is read with the clock at that moment.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect } from '../pg-test'
import { Assets, type Row, istLabel, realTime } from './assets'

const scenario = scenarioFor(test, 'asset-repair-jobs')
afterEach(realTime)

const AC = 'Voltas 2-ton split AC'
const COLD_ROOM = 'walk-in cold room'
const HOUR = 3_600_000

type State = { assets: Assets; assetId: string; problem: string; job: Row }

/** The asset each spec job is reported on. */
const assetFor = (assets: Assets, problem: string) =>
  problem === 'Door seal torn' ? assets.asset(COLD_ROOM, 'Enchakkal WH 9151') : assets.asset(AC, 'ATK 1501', { type: 'AC' })

/** A job reported by store staff. */
async function reported(assets: Assets, problem: string, values: Record<string, unknown> = {}): Promise<State> {
  const assetId = await assetFor(assets, problem)
  const job = await assets.save('store staff', 'equipment.job', { asset: assetId, problem, ...values })
  return { assets, assetId, problem, job }
}

const changeJob = (assets: Assets, name: string, id: string, values: Record<string, unknown>, attempt = false) =>
  assets.change(name, 'equipment.job', id, values, attempt)
const jobNow = (assets: Assets, id: string) => assets.get('equipment.job', id)

async function fixedByRavi(assets: Assets, problem: string) {
  const state = await reported(assets, problem)
  await changeJob(assets, 'a manager', state.job.row_id, { assigned_to: await assets.who('Ravi') })
  await changeJob(assets, 'Ravi', state.job.row_id, { job_state: 'In progress' })
  await changeJob(assets, 'Ravi', state.job.row_id, { job_state: 'Fixed', work_done: 'Replaced the start capacitor' })
  expect((await jobNow(assets, state.job.row_id)).job_state).toBe('Fixed')
  return state
}

/** The asset page as a person sees it, once it shows the asset. */
async function openAsset(assets: Assets, name: string, assetId: string) {
  await assets.open(name, `asset=${encodeURIComponent(assetId)}`)
  await screen.findByRole('heading', { name: String((await assets.get('equipment.asset', assetId)).asset_name) })
}

/** A section of the open asset page ('Open jobs', 'Past jobs'), as text, once it lists something. */
async function sectionText(name: string) {
  const section = await screen.findByRole('region', { name })
  await waitFor(() => expect(section.querySelector('li, p')).not.toBeNull())
  return section.textContent!
}

/** The jobs board's card for the job on `assetId`: the column it sits in and its text. */
async function boardCard(assets: Assets, name: string, assetId: string) {
  const assetName = String((await assets.get('equipment.asset', assetId)).asset_name)
  await assets.open(name, 'jobs')
  const user = userEvent.setup()
  // Empty columns, and Closed and Cancelled, start folded to a strip: open them all to find the card.
  await screen.findByRole('region', { name: 'Reported' }).catch(() => screen.findAllByRole('button', { name: /^Show .+, \d+ jobs?$/ }))
  for (let strip = screen.queryAllByRole('button', { name: /^Show .+, \d+ jobs?$/ })[0]; strip; strip = screen.queryAllByRole('button', { name: /^Show .+, \d+ jobs?$/ })[0])
    await user.click(strip)
  const card = await waitFor(() => {
    const link = document.querySelector(`article.job-card a[href="#asset=${encodeURIComponent(assetId)}"]`)
    expect(link, 'the job is on the board').not.toBeNull()
    const card = link!.closest('article.job-card') as HTMLElement
    // The card names its asset once the register has arrived.
    expect(card).toHaveTextContent(assetName)
    return card
  })
  return { column: card.closest('section[aria-label]')?.getAttribute('aria-label'), text: card.textContent! }
}

describe('asset-repair-jobs', () => {
  scenario('The AC stops cooling', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let assetId = ''
    await step('store staff open the "Voltas 2-ton split AC" page', async () => {
      assetId = await assets.asset(AC, 'ATK 1501', { type: 'AC' })
      await openAsset(assets, 'store staff', assetId)
    })
    await step('they report "Not cooling" as Urgent', async () => {
      const user = userEvent.setup()
      const form = screen.getByRole('region', { name: 'Report a fault' })
      await user.type(within(form).getByLabelText('What’s wrong?'), 'Not cooling')
      await user.click(within(form).getByRole('radio', { name: 'Urgent' }))
      await user.click(within(form).getByRole('button', { name: 'Send report' }))
      await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Report sent'))
    })
    await step('a repair job "Not cooling" is waiting for the AC at ATK 1501', async () => {
      const jobs = (await assets.list('equipment.job', [['asset', '=', assetId]], ['row_id', 'problem', 'priority', 'job_state', 'place'])).filter(job => job.problem === 'Not cooling')
      expect(jobs, 'one "Not cooling" job on the AC').toHaveLength(1)
      expect(jobs[0]).toMatchObject({ job_state: 'Reported', priority: 'Urgent', place: await assets.place('ATK 1501') })
      await waitFor(async () => expect(await sectionText('Open jobs')).toMatch(/Not cooling\s*Urgent · Reported/))
    })
  })

  scenario('An urgent job runs late', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let state: State
    let now = 0
    await step('"Not cooling" was reported as Urgent at 10:00', async () => {
      state = await reported(assets, 'Not cooling', { priority: 'Urgent' })
      expect(state.job.priority).toBe('Urgent')
    })
    await step('it is 16:00 and the job is not fixed', async () => {
      const job = await jobNow(assets, state.job.row_id)
      expect(job.job_state).not.toBe('Fixed')
      now = Date.parse(String(job.reported_at)) + 6 * HOUR
    })
    await step('the job shows it is late by 2 hours', async () => {
      assets.setClock(now)
      await openAsset(assets, 'store staff', state.assetId)
      await waitFor(async () => expect(await sectionText('Open jobs')).toMatch(/Late by 2h\b/))
    })
  })

  scenario('Raising the priority brings the time forward', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let state: State
    await step('"Door seal torn" was reported as Normal at 10:00', async () => {
      state = await reported(assets, 'Door seal torn', { priority: 'Normal' })
      expect(state.job.priority).toBe('Normal')
    })
    await step('a manager raises it to High', () => changeJob(assets, 'a manager', state.job.row_id, { priority: 'High' }))
    await step('it is due for fixing at 10:00 the next day', async () => {
      const job = await jobNow(assets, state.job.row_id)
      expect(Date.parse(String(job.fix_by))).toBe(Date.parse(String(job.reported_at)) + 24 * HOUR)
      // Read at the moment it was reported, the clock shows exactly a day left.
      assets.setClock(Date.parse(String(job.reported_at)))
      await openAsset(assets, 'a manager', state.assetId)
      await waitFor(async () => expect(await sectionText('Open jobs')).toMatch(/High · Reported\s*1d left/))
    })
  })

  scenario('From failure to restoration', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    const TIMELINE = [['Stopped working', 'failure_started_at'], ['Reported', 'reported_at'], ['Responded', 'responded_at'], ['Repair started', 'repair_started_at'], ['Restored', 'restored_at']] as const
    let state: State
    let timeline: Record<string, unknown> = {}
    await step('"Door seal torn" was reported, saying the cold room stopped 10 minutes earlier', async () => {
      state = await reported(assets, 'Door seal torn', { failure_started_at: new Date(Date.now() - 10 * 60_000).toISOString() })
      const gap = Date.parse(String(state.job.reported_at)) - Date.parse(String(state.job.failure_started_at))
      expect(gap >= 10 * 60_000 && gap < 11 * 60_000, `stopped 10 minutes before it was reported, not ${gap} ms`).toBe(true)
    })
    await step('Ravi is assigned, starts the repair and fixes it', async () => {
      await changeJob(assets, 'a manager', state.job.row_id, { assigned_to: await assets.who('Ravi') })
      await changeJob(assets, 'Ravi', state.job.row_id, { job_state: 'In progress' })
      await changeJob(assets, 'Ravi', state.job.row_id, { job_state: 'Fixed', work_done: 'Replaced the door seal' })
    })
    await step('the job shows when the cold room stopped, was reported, was responded to, repair started and was restored, in that order', async () => {
      const stored = await jobNow(assets, state.job.row_id)
      const times = TIMELINE.map(([label, field]) => { expect(stored[field], `${label} is recorded`).toBeTruthy(); return Date.parse(String(stored[field])) })
      for (let index = 1; index < times.length; index += 1)
        expect(times[index]! >= times[index - 1]!, `${TIMELINE[index]![0]} comes after ${TIMELINE[index - 1]![0]}`).toBe(true)
      timeline = Object.fromEntries(TIMELINE.map(([, field]) => [field, stored[field]]))
      await openAsset(assets, 'store staff', state.assetId)
      const article = await screen.findByRole('article', { name: state.problem })
      const items = within(within(article).getByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
      expect(items.map(item => item.textContent!.replace(/\s+/g, ' ').trim()))
        .toEqual(TIMELINE.map(([label, field]) => `${label} ${istLabel(String(stored[field]))}`))
    })
    await step('none of those times changes when the job is saved again', async () => {
      await changeJob(assets, 'Ravi', state.job.row_id, { cause: 'Seal perished', job_state: 'Fixed', work_done: 'Replaced the door seal' })
      const again = await jobNow(assets, state.job.row_id)
      expect(again.cause).toBe('Seal perished')
      for (const [label, field] of TIMELINE) expect(again[field], `${label} did not move`).toBe(timeline[field])
    })
  })

  scenario('Assigning a job', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let state: State
    await step('"Not cooling" is Reported', async () => {
      state = await reported(assets, 'Not cooling')
      expect(state.job.job_state).toBe('Reported')
    })
    await step('a manager assigns it to Ravi', async () => changeJob(assets, 'a manager', state.job.row_id, { assigned_to: await assets.who('Ravi') }))
    await step('the job is Assigned to Ravi', async () => {
      const job = await jobNow(assets, state.job.row_id)
      expect(job.job_state).toBe('Assigned')
      expect(job.assigned_to).toBe(await assets.who('Ravi'))
      const card = await boardCard(assets, 'a manager', state.assetId)
      expect(card.column).toBe('Assigned')
      expect(card.text).toMatch(/\bRavi\b/)
    })
  })

  scenario('Store staff cannot close a job', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let state: State
    await step('"Not cooling" is Assigned to Ravi', async () => {
      state = await reported(assets, 'Not cooling')
      await changeJob(assets, 'a manager', state.job.row_id, { assigned_to: await assets.who('Ravi') })
      expect((await jobNow(assets, state.job.row_id)).job_state).toBe('Assigned')
    })
    await step('store staff try to mark it Fixed', () =>
      // With a note of the work, so only who is asking can refuse it.
      changeJob(assets, 'store staff', state.job.row_id, { job_state: 'Fixed', work_done: 'Replaced the start capacitor' }, true))
    await step('the change is refused', async () => {
      assets.refused()
      expect((await jobNow(assets, state.job.row_id)).job_state).toBe('Assigned')
    })
  })

  scenario('Fixing without a note', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let state: State
    await step('"Not cooling" is In progress', async () => {
      state = await reported(assets, 'Not cooling')
      await changeJob(assets, 'a manager', state.job.row_id, { assigned_to: await assets.who('Ravi') })
      await changeJob(assets, 'Ravi', state.job.row_id, { job_state: 'In progress' })
      expect((await jobNow(assets, state.job.row_id)).job_state).toBe('In progress')
    })
    await step('Ravi marks it Fixed without saying what was done', () => changeJob(assets, 'Ravi', state.job.row_id, { job_state: 'Fixed' }, true))
    await step('the change is refused, asking what was done', async () => {
      assets.refused(/Say what was done/)
      expect((await jobNow(assets, state.job.row_id)).job_state).toBe('In progress')
    })
  })

  scenario('Store staff confirm', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let state: State
    await step('Ravi fixed "Not cooling"', async () => { state = await fixedByRavi(assets, 'Not cooling') })
    await step('store staff confirm it works', async () => {
      await openAsset(assets, 'store staff', state.assetId)
      const item = within(await screen.findByRole('region', { name: 'Waiting for you to confirm' })).getByRole('article', { name: state.problem })
      await userEvent.setup().click(within(item).getByRole('button', { name: 'Confirm it works' }))
      await within(await screen.findByRole('region', { name: 'Past jobs' })).findByText(/Closed · confirmed/)
    })
    await step('the job is closed, with who confirmed it and when', async () => {
      const confirmations = await assets.list('equipment.restoration', [['job', '=', state.job.row_id]], ['row_id', 'job', 'created_by', 'created_at'])
      expect(confirmations).toHaveLength(1)
      const [confirmation] = confirmations
      expect(confirmation!.created_by, 'store staff confirmed it').toBe(await assets.who('store staff'))
      expect(confirmation!.created_at, 'when it was confirmed').toBeTruthy()
      const past = await sectionText('Past jobs')
      expect(past).toContain(state.problem)
      expect(past).toContain(`Closed · confirmed ${istLabel(String(confirmation!.created_at))}`)
      expect((await boardCard(assets, 'store staff', state.assetId)).column).toBe('Closed')
    })
  })

  scenario('The technician cannot confirm their own work', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let state: State
    await step('Ravi fixed "Not cooling"', async () => { state = await fixedByRavi(assets, 'Not cooling') })
    await step('Ravi tries to confirm it', () => assets.save('Ravi', 'equipment.restoration', { job: state.job.row_id }, true))
    await step('the confirmation is refused', async () => {
      assets.refused(/Someone other than the technician/)
      expect(await assets.list('equipment.restoration', [['job', '=', state.job.row_id]])).toHaveLength(0)
    })
  })

  scenario('Under warranty', async ({ createUser, admin }, step) => {
    const assets = await Assets.start({ createUser, admin })
    let state: State
    await step("the AC's warranty runs until 12 March 2027", async () => {
      await assets.asset(AC, 'ATK 1501', { type: 'AC', warranty_until: '2027-03-12' })
    })
    await step('"Not cooling" is opened on 7 November 2026', async () => {
      state = await reported(assets, 'Not cooling')
      assets.setClock('2026-11-07T10:00:00+05:30')
    })
    await step('the job shows the AC is under warranty until 12-Mar-2027', async () => {
      const card = await boardCard(assets, 'Ravi', state.assetId)
      expect(card.text).toMatch(/Warranty to 12-Mar-2027/)
    })
  })
})
