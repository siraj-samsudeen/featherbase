import { currentEnvironment, environmentDeclared, overrideVariable, readVariable } from './env'

export { environmentDeclared }

// Which environment this process is running as (env.ts currentEnvironment).
// Vitest sets NODE_ENV=test itself, so the test suites land on 'test' without
// configuring anything. Fixed for the life of the process.
export const environment = currentEnvironment()

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
  port: Number(readVariable('PORT') ?? 8000),
  environment,
  databaseUrl:
    readVariable('DATABASE_URL') ??
    `postgres://postgres:postgres@127.0.0.1:5432/${defaultDatabase}`,
  // API-008: origins allowed to call the API cross-origin (the Admin dev
  // server by default; comma-separated WEB_ORIGINS overrides).
  allowedOrigins: (
    readVariable('WEB_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173'
  ).split(','),
  // The deployment's own absolute URL, as a browser sees it (`https://app.example.com`).
  // Used for links the server hands out — password-reset emails, and the OAuth
  // `redirect_uri`. Configuration, so it cannot be steered by a request header;
  // empty means "derive it from the request", which is what a dev checkout does.
  // Read at call time; assigning it sets SITE_URL for this process only, which
  // the release checks see too (env.ts overrideVariable).
  get siteUrl(): string {
    return (readVariable('SITE_URL') ?? '').trim().replace(/\/+$/, '')
  },
  set siteUrl(value: string) {
    overrideVariable('SITE_URL', value)
  },
}

// The only environments where a link the server emails may be built from the
// request's own origin when SITE_URL is unset (#430). Everywhere else SITE_URL
// is required: release-preflight refuses without it.
export const ORIGIN_FALLBACK_ENVIRONMENTS: readonly string[] = ['development', 'test']
