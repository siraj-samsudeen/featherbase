import { registerJob } from '../jobs'

// A no-op health/demo job — useful for exercising the queue (JOB-004 retry).
registerJob('ping_job', async () => {
  // intentionally does nothing; always succeeds
})
