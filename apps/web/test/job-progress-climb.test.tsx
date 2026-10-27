// "Watch a job progress" (background-and-scheduled-jobs spec), end to end on
// the page: a job reports several steps while it runs, and the Background Jobs
// page follows it up to 100% and done without waiting on it. A file of its
// own because the page's realtime client is a module singleton: a second
// bridged test in job-progress.test.tsx would reuse the first test's socket,
// whose bridge has already been stopped.
import { screen, waitFor } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { sql } from 'server/src/db'
import { drainJobs, enqueue, registerJob } from 'server/src/jobs'
import { test, expect, renderApp } from './pg-test'
import { bridgeRealtime } from './realtime-bridge'

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  vi.unstubAllGlobals()
})

test('a running job climbs toward done while the page stays live, and lands at 100% and done', async ({ admin }) => {
  stop = bridgeRealtime()
  let release!: () => void
  const halfway = new Promise<void>((r) => (release = r))
  registerJob('web_progress_climb', async (_payload, ctx) => {
    ctx.setProgress(25, 'Reading shelves')
    await halfway
    ctx.setProgress(60, 'Counting stock')
    ctx.setProgress(100, 'Finished')
  })
  await renderApp('/featherbase/admin/jobs', admin)
  await screen.findByTestId('job-monitor', {}, { timeout: 8000 })
  await waitFor(() => expect(document.documentElement.dataset.realtimeChannels).toContain('user:Administrator'))

  const row = await enqueue('web_progress_climb', {})
  await sql`update background_job set run_at = now() where method = 'web_progress_climb'`
  // Not awaited: the job is still running while the page is read.
  const draining = drainJobs()

  await waitFor(() => expect(screen.getByTestId('demo-progress-percent')).toHaveTextContent('25%'))
  expect(screen.getByTestId('demo-progress')).toHaveTextContent('Reading shelves')
  // The page is not stuck waiting: its job list refreshes and shows the job running.
  await waitFor(() => expect(screen.getByTestId(`job-status-${row}`)).toHaveTextContent('running'), { timeout: 6000 })

  release()
  await draining
  await waitFor(() => expect(screen.getByTestId('demo-progress-percent')).toHaveTextContent('100%'))
  expect(screen.getByTestId('demo-progress')).toHaveTextContent('Finished')
  expect(screen.getByTestId('demo-progress-bar')).toHaveStyle({ width: '100%' })
  await waitFor(() => expect(screen.getByTestId(`job-status-${row}`)).toHaveTextContent('done'), { timeout: 6000 })
}, 20000)
