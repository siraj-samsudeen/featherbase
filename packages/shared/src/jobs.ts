// #464: the Jobs page and the job alert email name a scheduled job the same
// way, from its method: "disable_leavers" reads "Disable leavers".

export const JOBS_PATH = '/featherbase/admin/jobs'

export function jobTitle(method: string): string {
  const words = method.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : method
}
