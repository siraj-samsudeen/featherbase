import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// EDS-1/BV7: data-source credentials live in environment variables. For dev
// convenience an optional apps/server/.env (gitignored) is loaded once at
// boot — KEY=VALUE lines only, never overriding variables already set by the
// shell. Values stay in process.env; nothing is persisted or logged.
function loadDotEnv() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const file = path.resolve(here, '../.env')
    if (!existsSync(file)) return
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (!m || line.trim().startsWith('#')) continue
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2')
      if (process.env[m[1]] === undefined) process.env[m[1]] = value
    }
  } catch {
    // A malformed .env never blocks boot.
  }
}
loadDotEnv()

// Which environment this process is running as. Vitest sets NODE_ENV=test
// itself, so the test suites land on 'test' without configuring anything.
// FEATHERBASE_ENV wins when set, for the cases NODE_ENV cannot express.
export const environment = (
  process.env.FEATHERBASE_ENV ??
  process.env.NODE_ENV ??
  'development'
).trim()

// The default database is derived from the environment, never shared across
// them. Rails (`app_development` / `app_test`), Phoenix (`app_dev` /
// `app_test`) and Django (a `test_` prefix) all separate the two BY NAME, so
// that running tests against the development database takes a deliberate act
// rather than a forgotten variable.
//
// This project used to default both to `featherbase`, which made OMITTING
// DATABASE_URL the thing that pointed a test run at the developer's own
// database — the default was backwards. An explicit DATABASE_URL still wins,
// and the environment stamp (src/db-environment.ts) catches the case where
// that explicit value is wrong.
const defaultDatabase = environment === 'test' ? 'featherbase_test' : 'featherbase'

export const config = {
  port: Number(process.env.PORT ?? 8000),
  environment,
  databaseUrl:
    process.env.DATABASE_URL ??
    `postgres://postgres:postgres@127.0.0.1:5432/${defaultDatabase}`,
  // API-008: origins allowed to call the API cross-origin (the Admin dev
  // server by default; comma-separated WEB_ORIGINS overrides).
  allowedOrigins: (
    process.env.WEB_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
  ).split(','),
  // The deployment's own absolute URL, as a browser sees it (`https://app.example.com`).
  // Used for links the server hands out — password-reset emails, and the OAuth
  // `redirect_uri`. Configuration, so it cannot be steered by a request header;
  // empty means "derive it from the request", which is what a dev checkout does.
  siteUrl: (process.env.SITE_URL ?? '').trim().replace(/\/+$/, ''),
}
