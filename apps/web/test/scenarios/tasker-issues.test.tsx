// tasker-issues's scenarios (#1070): each test is one fenced scenario of
// openspec/specs/tasker-issues/spec.md, step by step, with Tasker's page
// rendered in jsdom against the real in-process server.
//
// Issue clocks run on the server's time. A scenario that says when something
// happens sets the app's clock and moves it on; then the escalation job,
// which re-checks open issues every minute, runs.
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect } from '../pg-test'
import { TaskerWorld, type TaskerPage, dayFrom, realTime } from './tasker'

const scenario = scenarioFor(test, 'tasker-issues')
afterEach(realTime)

// The day the scenarios' issues are raised, and the store hours' time zone.
const RAISED_ON = '2026-11-04'
const IST = '+05:30'
const MINUTE = 60_000
const at = (day: string, time: string) => `${day}T${time}:00${IST}`
const CHILLER = 'Dairy chiller 2 at 9°C'

/** "06-Nov-2026 10:00 IST" -> a Date. */
function istInstant(text: string) {
  const [, day, month, year, time] = text.match(/(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}:\d{2}) IST/)!
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return new Date(at(`${year}-${String(months.indexOf(month!) + 1).padStart(2, '0')}-${day}`, time!))
}

/** An issue raised at ATK Avadi at 10:00 on the raising day, by the System Manager, with these values. */
async function raisedIssue(tasker: TaskerWorld, title: string, { store = 'ATK Avadi', ...values }: Record<string, unknown> = {}) {
  tasker.setClock(at(RAISED_ON, '10:00'))
  const where = await tasker.store(String(store))
  return tasker.raise(title, { store: where.row_id, ...values })
}

/** Moves the app's clock on to half an hour past the issue's fix deadline, and the job checks it. */
async function pastFixTime(tasker: TaskerWorld) {
  const issue = await tasker.issueRow()
  tasker.setClock(Date.parse(String(issue.fix_by)) + 30 * MINUTE)
  await tasker.escalationRun()
}

const moveClock = (tasker: TaskerWorld, by: number) => tasker.setClock(Date.now() + by)

async function openIssues(page: TaskerPage) {
  await page.sidebarView(/^Issues/)
  await screen.findByRole('heading', { name: 'Issues' })
}

const issueList = (closed = false) => screen.findByRole('list', { name: closed ? 'All issues' : 'Open issues' })
const issueRow = async (title: string, closed = false) => within(await issueList(closed)).findByRole('listitem', { name: title })

async function openIssue(page: TaskerPage, title: string, closed = false) {
  await page.user.click(within(await issueRow(title, closed)).getByRole('link', { name: title }))
  const detail = await screen.findByRole('region', { name: 'Issue detail' })
  await within(detail).findByRole('heading', { name: title })
  return detail
}

/** The one-line clock an issue's row shows. */
const clockChip = async (title: string, closed = false) =>
  (await issueRow(title, closed)).querySelector('.tasker-issue-clock-chip')!.textContent!.trim()

const clockText = (detail: HTMLElement, name: string) => within(detail).getByRole('group', { name }).textContent!.trim()

/** The time on the resolution clock, as the details say it ('2h', '45m'). */
function onTheClock(detail: HTMLElement) {
  const line = [...within(detail).getByRole('group', { name: 'Resolution clock' }).querySelectorAll('p')].find(p => p.textContent!.includes('on the clock'))
  return line?.textContent!.trim().match(/on the clock (.+)$/)?.[1] ?? null
}

/** The "For you" notices of a kind about an issue, as text. */
function noticesFor(title: string, kind: string) {
  const notices = screen.queryByRole('region', { name: 'For you' })
  if (!notices) return []
  return [...notices.querySelectorAll(`li[data-kind="${kind}"]`)]
    .filter(li => within(li as HTMLElement).queryByRole('link', { name: title }))
    .map(li => li.textContent!)
}

describe('tasker-issues', () => {
  scenario('A chiller fault', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    const title = 'Dairy chiller 2: Equipment failure'
    await step('Meena is a Tasker member', () => tasker.id('Meena'))
    await step('she raises a High "Equipment failure" issue at ATK Avadi for "Dairy chiller 2"', async () => {
      await tasker.store('ATK Avadi')
      const page = await tasker.as('Meena')
      await openIssues(page)
      await page.session.clickButton('Raise an issue')
      const form = await screen.findByRole('form', { name: 'Raise an issue' })
      // Each choice's <label> also holds its options' text, which the DSL's label lookup can't match.
      const choose = (name: string, option: string) => page.user.selectOptions(within(form).getByRole('combobox', { name }), option)
      await page.session.within('form[aria-label="Raise an issue"]', (raise) => raise
        .fillIn('What happened', title)
        .step('category: Equipment failure', () => choose('Category', 'Equipment failure'))
        .step('severity: High', () => choose('Severity', 'High'))
        .assertText('ATK Avadi')
        .step('store: ATK Avadi', () => choose('Store', 'ATK Avadi'))
        .fillIn('Asset or area', 'Dairy chiller 2')
        .clickButton('Raise issue'))
      await waitFor(() => expect(screen.queryByRole('form', { name: 'Raise an issue' })).not.toBeInTheDocument())
      await tasker.findIssue(title)
    })
    await step('the issue is open with a response deadline and a fix deadline', async () => {
      const page = await tasker.as('Meena')
      await openIssues(page)
      const detail = await openIssue(page, title)
      const respondBy = istInstant(clockText(detail, 'Response clock').match(/Respond by (.+? IST)/)![1]!)
      const fixBy = istInstant(clockText(detail, 'Resolution clock').match(/Fix by (.+? IST)/)![1]!)
      expect(respondBy.getTime(), `the response deadline ${respondBy.toISOString()} is already past`).toBeGreaterThan(Date.now() - MINUTE)
      expect(fixBy.getTime(), `the fix deadline ${fixBy.toISOString()} is not after the response deadline`).toBeGreaterThan(respondBy.getTime())
      expect((await tasker.issueRow()).issue_state).toBe('Open')
    })
  })

  scenario('Store hours skip the night', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('a High issue is raised at 21:00 with a fix time of 1 day in store hours from 09:00 to 22:00', async () => {
      await tasker.slaRule('High', { respond_minutes: 60, fix_minutes: 1440, clock: 'Store hours' })
      const store = await tasker.store('ATK Avadi', { opens_at: '09:00', closes_at: '22:00' })
      tasker.setClock(at(RAISED_ON, '21:00'))
      await tasker.raise('Freezer door seal torn', { severity: 'High', store: store.row_id })
    })
    await step('its time on the clock at 10:00 next morning is 2 hours', async () => {
      tasker.setClock(at(dayFrom(RAISED_ON, 1), '10:00'))
      await tasker.escalationRun()
      const page = await tasker.as('a member')
      await openIssues(page)
      const detail = await openIssue(page, 'Freezer door seal torn')
      await waitFor(() => expect(onTheClock(detail)).toBe('2h'))
    })
  })

  scenario('Breach', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('a High issue at ATK Avadi owned by Suresh in Facilities', async () => {
      await raisedIssue(tasker, CHILLER, { store: 'ATK Avadi', severity: 'High', owner: await tasker.id('Suresh'), owner_function: 'Facilities' })
    })
    await step("ATK Avadi's store manager is Meena and the Facilities head is Kumar", async () => {
      await tasker.store('ATK Avadi', { store_manager: await tasker.id('Meena') })
      await tasker.functionHead('Facilities', await tasker.id('Kumar'))
    })
    await step('its fix time passes without submission', () => pastFixTime(tasker))
    await step('Meena and Kumar are notified once and the issue shows it is breached', async () => {
      // Two more minutes pass, each checked by the escalation job: a breach is
      // told once, not at every check.
      for (let minute = 0; minute < 2; minute += 1) {
        moveClock(tasker, MINUTE)
        await tasker.escalationRun()
      }
      for (const name of ['Meena', 'Kumar']) {
        const page = await tasker.as(name)
        await openIssues(page)
        await waitFor(() => expect(noticesFor(CHILLER, 'breach'), `${name}'s breach notices`).toHaveLength(1))
        expect(await clockChip(CHILLER)).toMatch(/^Breached by /)
      }
      const page = await tasker.as('Meena')
      await openIssues(page)
      const detail = await openIssue(page, CHILLER)
      const log = [...within(detail).getByRole('list', { name: 'Escalation log' }).querySelectorAll('li[data-kind="breach"]')].map(li => li.textContent!)
      expect(log, `breach entries in the log: ${JSON.stringify(log)}`).toHaveLength(1)
      expect(log[0]).toMatch(/notice to .*Meena/)
      expect(log[0]).toMatch(/notice to .*Kumar/)
    })
  })

  scenario('Unapproved waiting', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('Suresh asks to pause an issue while waiting for the vendor', async () => {
      const suresh = await tasker.id('Suresh')
      // The store has a manager who could approve the pause.
      await tasker.store('ATK Avadi', { store_manager: await tasker.id('Meena') })
      const issue = await raisedIssue(tasker, CHILLER, { owner: suresh })
      const asked = await tasker.save('tasker.issue',
        { row_id: issue.row_id, pause_requested: true, pause_reason: 'Waiting for the vendor', pause_review_on: dayFrom(RAISED_ON, 2) }, suresh)
      expect(asked.pause_requested).toBe(true)
      expect(asked.on_clock_minutes).toBe(0)
    })
    await step('the store manager has not approved it', async () => {
      expect((await tasker.issueRow()).paused).toBe(false)
      // Two hours of store time go by with the pause still only asked for.
      moveClock(tasker, 120 * MINUTE)
      await tasker.escalationRun()
    })
    await step("the issue's clock keeps running", async () => {
      const page = await tasker.as('Suresh')
      await openIssues(page)
      const detail = await openIssue(page, CHILLER)
      await waitFor(() => expect(onTheClock(detail)).toBe('2h'))
      const status = [...detail.querySelectorAll('.tasker-issue-status')].map(p => p.textContent!)
      expect(status.some(line => line.startsWith('Pause asked for · the clock runs until the store manager approves')), JSON.stringify(status)).toBe(true)
      expect(status.some(line => line.startsWith('Paused since')), JSON.stringify(status)).toBe(false)
    })
  })

  scenario('Breach survives closure', async ({ createUser, admin }, step) => {
    const tasker = await TaskerWorld.start({ createUser, admin })
    await step('an issue breached its fix time', async () => {
      await raisedIssue(tasker, CHILLER, { owner: await tasker.id('Suresh'), verifier: await tasker.id('Meena') })
      await pastFixTime(tasker)
      expect((await tasker.issueRow()).fix_breached, 'the issue did not breach').toBe(true)
    })
    await step('it is submitted and accepted', async () => {
      const owner = await tasker.as('Suresh')
      await openIssues(owner)
      let detail = await openIssue(owner, CHILLER)
      // Either name, by pattern: which one the owner is offered is not this scenario's.
      await owner.user.click(within(detail).getByRole('button', { name: /^(Submit for verification|Close issue)$/ }))
      await owner.session.within('[aria-label="Issue detail"]', (issue) => issue
        .fillIn('What was done', 'Compressor relay replaced; 3°C after an hour')
        .clickButton('Submit'))
      await waitFor(() => expect(within(detail).queryByRole('textbox', { name: 'What was done' })).not.toBeInTheDocument())
      const verifier = await tasker.as('Meena')
      await openIssues(verifier)
      detail = await openIssue(verifier, CHILLER)
      await verifier.session.within('[aria-label="Issue detail"]', (issue) => issue.clickButton('Accept and close'))
      await waitFor(() => expect(within(detail).queryByRole('button', { name: 'Accept and close' })).not.toBeInTheDocument())
    })
    await step('it is closed and still shows it breached', async () => {
      const page = await tasker.as('Meena')
      await openIssues(page)
      await page.session.check('Show closed')
      await waitFor(async () => expect(await clockChip(CHILLER, true)).toBe('Closed · fix time was breached'))
      const detail = await openIssue(page, CHILLER, true)
      expect(detail.textContent).toMatch(/Fix time breached \d{2}-[A-Z][a-z]{2}-\d{4}/)
      expect(clockText(detail, 'Verification clock')).toMatch(/Verified by Meena/)
      expect(await tasker.issueRow()).toMatchObject({ issue_state: 'Closed', fix_breached: true })
    })
  })
})
