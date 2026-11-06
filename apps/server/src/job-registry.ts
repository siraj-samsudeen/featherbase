// Which job methods exist. No imports, so this is ready before anything can call
// registerJob, whatever order the modules load in: webhooks and email register as
// they load, and in the web test runner that can happen while jobs.ts is mid-load.
import type { JobHandler } from './jobs'

export const registry = new Map<string, JobHandler>()
// #700: which app registered a method; absent for the platform's own jobs.
export const owners = new Map<string, string>()

// #971: jobs that take the app lifecycle lock themselves, only for the part
// that needs it, because they spend long on an outside read.
export const ownLifecycleLock = new Set<string>()
