import { useEffect, useState } from 'react'
import { jobClock, type ClockedJob } from './jobRules'

/** The fix-by clock, refreshed every minute while the page is open. */
export function JobClock({ job }: { job: ClockedJob }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const clock = jobClock(job, now)
  return <span className="job-clock" data-tone={clock.tone}>{clock.label}</span>
}
