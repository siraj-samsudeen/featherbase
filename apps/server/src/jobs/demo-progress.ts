import { registerJob } from '../jobs'

// JOB-005 demo: a "long" job that reports progress to the client as it runs.
const STEPS = 5

registerJob('demo_progress', async (_payload, ctx) => {
  for (let i = 1; i <= STEPS; i++) {
    await new Promise((r) => setTimeout(r, 150))
    ctx.setProgress((i / STEPS) * 100, `Processing step ${i} of ${STEPS}`)
  }
  return { steps: STEPS }
})
