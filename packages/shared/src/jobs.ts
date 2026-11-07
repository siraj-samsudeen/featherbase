// #464: the Jobs page and the job alert email name a scheduled job the same
// way, from its method: "auto_email_reports" reads "Auto email reports".

export const JOBS_PATH = '/featherbase/admin/jobs'

export const COPY_CADENCES = ['every 15 minutes', 'hourly', 'every 4 hours', 'daily'] as const

export function jobTitle(method: string): string {
  const words = method.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : method
}
