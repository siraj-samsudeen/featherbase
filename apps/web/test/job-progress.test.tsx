// JOB-005 / "Watch a job progress" (background-and-scheduled-jobs spec): a
// job that reports progress shows it climbing on the Background Jobs page.
// The merged web coverage report (ADR 0012) showed no test reaching it — no
// shipped job reports progress yet, so e2e cannot. Here a job registered for
// the test reports through the real JobContext, the server publishes on the
// owner's channel, and realtime-bridge.ts carries it to the page.
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

test('a job reporting progress shows its message and percent on the jobs page', async ({ admin }) => {
  stop = bridgeRealtime()
  registerJob('web_progress_probe', async (_payload, ctx) => {
    ctx.setProgress(40, 'Counting stock')
  })
  await renderApp('/featherbase/admin/jobs', admin)
  await screen.findByTestId('job-monitor', {}, { timeout: 8000 })
  await waitFor(() => expect(document.documentElement.dataset.realtimeChannels).toContain('user:Administrator'))

  await enqueue('web_progress_probe', {})
  // Inside the rolled-back transaction now() is frozen at BEGIN; make the job due.
  await sql`update background_job set run_at = now() where method = 'web_progress_probe'`
  await drainJobs()

  const progress = await screen.findByTestId('demo-progress')
  expect(progress).toHaveTextContent('Counting stock')
  expect(screen.getByTestId('demo-progress-percent')).toHaveTextContent('40%')
})
