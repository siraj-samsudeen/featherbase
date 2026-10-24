// #432: a Data Source may never connect to the platform's own database, so the
// "foreign" stores the source tests read and write live in a sibling
// database on the same server: `<test database>_ext`. global-setup.ts creates
// it once per run; the tests create and drop their own schemas inside it.
import postgres from 'postgres'
import { config } from '../src/config'

export const EXTERNAL_DATABASE_URL = (() => {
  const url = new URL(config.databaseUrl)
  url.pathname = `/${decodeURIComponent(url.pathname.slice(1))}_ext`
  return url.toString()
})()

export async function ensureExternalDatabase(): Promise<void> {
  const name = decodeURIComponent(new URL(EXTERNAL_DATABASE_URL).pathname.slice(1))
  const admin = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
  try {
    const [row] = await admin`select 1 from pg_database where datname = ${name}`
    if (!row)
      await admin.unsafe(`create database "${name.replaceAll('"', '""')}"`).catch((err: { code?: string }) => {
        if (err.code !== '42P04') throw err // created by a concurrent run
      })
  } finally {
    await admin.end({ timeout: 5 })
  }
}
