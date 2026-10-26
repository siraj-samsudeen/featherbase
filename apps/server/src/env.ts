// The one module that reads process.env (instance-settings-as-code D6, #465).
// Every variable the server reads is declared in VARIABLES below; the
// DEPLOY.md table and apps/server/.env.example are generated from it
// (`pnpm --filter server generate:env`), and `pnpm --filter server lint:env`
// fails on a `process.env` anywhere else in src/.
//
// Reads are lazy: nothing here caches a value at import, so a test that stubs
// a variable sees it on the next call.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** When a variable must be present.
 *  - `outside-dev`: refuse release and server start when missing, except in
 *    development and test (which have working defaults);
 *  - `recommended`: warn when missing outside development and test;
 *  - `optional`: never checked;
 *  - `forbidden-in-production`: refuse release and server start while it is
 *    switched on, except in development, test and staging;
 *  - `{ when }`: required while the instance's stored settings turn a feature
 *    on (refused outside development and test, warned inside them). */
export type Requirement =
  | 'outside-dev'
  | 'recommended'
  | 'optional'
  | 'forbidden-in-production'
  | { when: SettingsCondition }

/** Facts about stored settings that make a variable required. The release
 *  preflight works them out from the database (release-preflight.ts). */
export type SettingsCondition = 'google-sign-in-enabled'

export const SETTINGS_CONDITIONS: Record<SettingsCondition, string> = {
  'google-sign-in-enabled': 'a Google sign-in method is enabled with a client id',
}

export interface Variable {
  name: string
  secret: boolean
  required: Requirement
  /** What it is for, written for the person setting up an environment. The
   *  DEPLOY.md table prints it as is (Markdown allowed). */
  purpose: string
  /** The default the server uses when it is unset, as shown in the docs. */
  default?: string
  /** The rule the environment comparison (D10) applies across environments. */
  crossEnvironment?: 'must-differ' | 'must-match'
  /** Is the feature it controls switched on by this value? Defaults to "set
   *  and not blank". Only meaningful for `forbidden-in-production`. */
  active?: (value: string) => boolean
  /** Appended to a refusal or warning: why it matters and how to fix it. */
  fix?: string
  /** The docs' "Required" cell, when the tier alone would mislead. */
  docsRequired?: string
  /** `forbidden-in-production` only: where it may be on, when narrower than
   *  TEST_MODE_ENVIRONMENTS. */
  allowedIn?: readonly string[]
}

/** Where a release refuses nothing that has a working local default. */
export const DEV_ENVIRONMENTS: readonly string[] = ['development', 'test']
/** Where the `forbidden-in-production` switches may be on: development, test,
 *  and `staging` (a hosted trial instance, production in every other respect). */
export const TEST_MODE_ENVIRONMENTS = ['development', 'test', 'staging'] as const

export const TEST_MODE_PHRASE = 'trust-any-password'

const ON_FORBIDDEN =
  'It is allowed only where FEATHERBASE_ENV (or NODE_ENV) is development, test or staging (a hosted trial instance).'

export const VARIABLES = [
  // ---- Identity of the process
  { name: 'FEATHERBASE_ENV', secret: false, required: 'optional', default: '`NODE_ENV`, then `development`',
    docsRequired: '**yes**, this or `NODE_ENV`, for a release',
    purpose: 'which environment this process is: `production`, `staging`, `development` or `test`; it wins over `NODE_ENV`. The release (and `cli boot-check`) refuses when neither is set (#430). Only `development` and `test` allow zero-setup Administrator credentials' },
  { name: 'NODE_ENV', secret: false, required: 'optional', default: '`development`',
    purpose: 'read only when `FEATHERBASE_ENV` is unset (Vitest sets it to `test`)' },
  // ---- Database and HTTP
  { name: 'DATABASE_URL', secret: true, required: 'outside-dev', crossEnvironment: 'must-differ',
    default: 'local `featherbase` (`featherbase_test` under test)',
    purpose: 'Postgres connection string. `db.ts` sets `prepare: false`, which transaction-mode poolers (such as Supabase on port 6543) require',
    fix: 'Point it at this environment\'s own Postgres.' },
  { name: 'PORT', secret: false, required: 'optional', default: '`8000`', purpose: 'HTTP and WebSocket port' },
  { name: 'WEB_ORIGINS', secret: false, required: 'optional', default: '`http://localhost:5173,http://127.0.0.1:5173`',
    purpose: 'comma-separated CORS allowlist; needed only when the SPA is served from another origin' },
  { name: 'SITE_URL', secret: false, required: 'outside-dev',
    purpose: 'this instance\'s absolute external URL (`https://app.example.com`): password-reset and invitation links, and the OAuth `redirect_uri`/cookie-`Secure` decision. Set, no request header can steer either; unset (development and test only), the server falls back to the request, trusting the first `x-forwarded-proto` hop',
    fix: 'Emailed links (sign-in invitations, password resets) need this instance\'s own address, which a request must not be able to steer. Set SITE_URL (https://…) first (docs/DEPLOY.md, "Configuration").' },
  // ---- Secrets
  { name: 'JWT_SECRET', secret: true, required: 'outside-dev', crossEnvironment: 'must-differ', default: '`dev-secret-change-me`',
    purpose: 'session and token signing. Must differ between environments, or one environment\'s sessions are valid on another',
    fix: 'Set a long random value, different in every environment (docs/DEPLOY.md, "Rotating credentials").' },
  { name: 'FILE_URL_SECRET', secret: true, required: 'optional', crossEnvironment: 'must-differ', default: '`JWT_SECRET`',
    purpose: 'signs the short-lived URLs of private files' },
  { name: 'ADMIN_PASSWORD', secret: true, required: 'optional',
    purpose: 'provisions a null Administrator password hash; missing or blank leaves production password login locked. Never rotates an existing hash (see [Rotating credentials](#rotating-credentials))' },
  { name: 'GOOGLE_CLIENT_SECRET', secret: true, required: { when: 'google-sign-in-enabled' }, crossEnvironment: 'must-match',
    purpose: 'the Google OAuth client secret; the client id and allowed domains live on the Google sign-in method',
    fix: 'Set it, or disable the Google sign-in method (docs/DEPLOY.md, "Sign-in methods and linked identities").' },
  // ---- Files and printing
  { name: 'FILE_STORAGE_DIR', secret: false, required: 'recommended', default: '`apps/server/storage`',
    purpose: 'uploaded-file directory; it must persist across deploys (on Railway, a Volume)',
    fix: 'Without it, uploads are written inside the container and vanish on the next deploy.' },
  { name: 'CHROMIUM_PATH', secret: false, required: 'optional',
    purpose: 'Chromium binary for PDF printing; unset, Playwright resolves its own. Never hardcoded' },
  { name: 'PLAYWRIGHT_BROWSERS_PATH', secret: false, required: 'optional', default: '`/opt/pw-browsers`',
    purpose: 'where PDF printing also looks for a Playwright-installed Chromium' },
  // ---- Email (see "Email")
  { name: 'SMTP_HOST', secret: false, required: 'optional',
    purpose: 'turns real delivery on (`smtp-relay.gmail.com`); unset or blank keeps the Email Sink. See [Email](#email)' },
  { name: 'SMTP_PORT', secret: false, required: 'optional', default: '`587`',
    purpose: '`587` = STARTTLS, `465` = implicit TLS. On every port but 465, STARTTLS is required' },
  { name: 'SMTP_USER', secret: false, required: 'optional', purpose: 'a Workspace user in the domain; turns on SMTP AUTH' },
  { name: 'SMTP_PASSWORD', secret: true, required: 'optional',
    purpose: 'that user\'s **app password**; required when `SMTP_USER` is set. Google\'s grouped display (`abcd efgh ijkl mnop`) has its spaces removed' },
  { name: 'MAIL_FROM', secret: false, required: 'optional',
    purpose: 'the From of every SMTP message (`Feather Dash <noreply@example.com>`); it wins over any Email Account address. Unset, the default Email Account\'s address is used' },
  { name: 'SMTP_NAME', secret: false, required: 'optional',
    purpose: 'the `EHLO` hostname. Unset, the domain of `MAIL_FROM`, then the host of `SITE_URL`, then the sender\'s domain' },
  // ---- Abuse limits (see "Public-route abuse limits")
  { name: 'PREAUTH_WINDOW_MS', secret: false, required: 'optional', default: '`900000`', purpose: 'pre-auth fixed window, in milliseconds' },
  { name: 'PREAUTH_LOGIN_MAX', secret: false, required: 'optional', default: '`60`', purpose: 'password and delegated sign-in submissions per source and window' },
  { name: 'PREAUTH_PASSWORD_MAX', secret: false, required: 'optional', default: '`5`', purpose: 'per provider, username and source' },
  { name: 'PREAUTH_OAUTH_LOGIN_MAX', secret: false, required: 'optional', default: '`30`', purpose: 'OAuth initiations per source and window' },
  { name: 'PREAUTH_OAUTH_CALLBACK_MAX', secret: false, required: 'optional', default: '`30`', purpose: 'OAuth callbacks per source and window' },
  { name: 'PREAUTH_FORM_MAX', secret: false, required: 'optional', default: '`30`', purpose: 'public web-form POSTs per source and window' },
  { name: 'PREAUTH_SIGNUP_MAX', secret: false, required: 'optional', default: '`10`', purpose: 'sign-ups per source and window' },
  { name: 'TRUSTED_PROXY_IPS', secret: false, required: 'optional', purpose: 'comma-separated exact socket IPs trusted to append `X-Forwarded-For`' },
  { name: 'RATE_LIMIT_WINDOW_MS', secret: false, required: 'optional', default: '`60000`', purpose: 'per-user API rate-limit window' },
  { name: 'RATE_LIMIT_MAX', secret: false, required: 'optional', default: '`100000`', purpose: 'per-user API requests per window, unless the person has their own limit' },
  // ---- Switches that must never be on in production
  { name: 'DELEGATED_LOGIN_TEST_MODE', secret: false, required: 'forbidden-in-production',
    active: (v) => v.trim() === TEST_MODE_PHRASE,
    purpose: '`trust-any-password` lets a linked account sign in by its employee code without a password, to try a rollout as any linked Team Leader. Any other value is ignored',
    fix: `Test mode lets anyone sign in as a linked person without a password, so it runs only where FEATHERBASE_ENV (or NODE_ENV) is development, test or staging (a hosted trial instance). Unset it, or set FEATHERBASE_ENV=staging on a trial instance (see docs/DEPLOY.md, "The person release").` },
  { name: 'ALLOW_MOCK_OAUTH', secret: false, required: 'forbidden-in-production',
    active: (v) => v === '1', allowedIn: DEV_ENVIRONMENTS,
    docsRequired: '**never outside development and test**',
    purpose: '`1` turns on the mock Google provider, which mints a session for any typed email from a pre-auth endpoint. For development and the test suites',
    fix: 'The mock provider signs anyone in as anyone, so it is allowed only where FEATHERBASE_ENV (or NODE_ENV) is development or test. Unset it.' },
  { name: 'PREVIEW_LOGIN_KEY', secret: true, required: 'forbidden-in-production',
    purpose: 'preview deployments: the one-link sign-in\'s secret, 32+ characters. See [PREVIEW.md](PREVIEW.md)',
    fix: `Preview sign-in is a one-link login. ${ON_FORBIDDEN} Unset it, or run the preview as staging.` },
  { name: 'PREVIEW_LOGIN_USER', secret: false, required: 'forbidden-in-production',
    purpose: 'preview deployments: the account the link signs in as (never Administrator)',
    fix: `Preview sign-in is a one-link login. ${ON_FORBIDDEN} Unset it, or run the preview as staging.` },
  // ---- Break-glass and tooling
  { name: 'DISABLE_DATABASE_ENVIRONMENT_CHECK', secret: false, required: 'optional',
    purpose: '`1` skips the check that the database was stamped by this environment. Break-glass only' },
  { name: 'FEATHERBASE_APP_PATHS', secret: false, required: 'optional', default: '`[]`', purpose: 'JSON array of extra app package directories to discover at boot' },
  { name: 'JOB_POLL_MS', secret: false, required: 'optional', default: '`500`', purpose: 'background worker poll interval' },
  { name: 'SERVER_URL', secret: false, required: 'optional', default: '`http://localhost:8000`', purpose: 'the server `pnpm smoke` probes' },
  // ---- Sales target (Feather Dash)
  { name: 'MOTHERDUCK_TOKEN', secret: true, required: 'optional', purpose: 'MotherDuck access for the sales-target embed and warehouse reads; never logged, returned or stored' },
  { name: 'MOTHERDUCK_API_BASE', secret: false, required: 'optional', default: '`https://api.motherduck.com`', purpose: 'MotherDuck API base' },
  { name: 'MOTHERDUCK_EMBED_ORIGIN', secret: false, required: 'optional', default: '`https://embed-motherduck.com`', purpose: 'the embed sandbox origin; overridable only for a local stub' },
  { name: 'DIVE_ID', secret: false, required: 'optional', purpose: 'the sales-target Dive' },
  { name: 'DIVE_VERSION', secret: false, required: 'optional', purpose: 'the sales-target Dive version' },
  { name: 'SERVICE_ACCOUNT', secret: false, required: 'optional', purpose: 'the MotherDuck service account the embed runs as' },
  { name: 'SALES_TARGET_TODAY', secret: false, required: 'optional', purpose: 'pins "today" (YYYY-MM-DD) for the sales target; for tests and rehearsals' },
  { name: 'SALES_TARGET_SHARED_ENV', secret: false, required: 'optional', purpose: 'path of a local `.env.local` the sales-target experiment reads `DIVE_ID`, `DIVE_VERSION` and `SERVICE_ACCOUNT` from' },
] as const satisfies readonly Variable[]

export type VariableName = (typeof VARIABLES)[number]['name']

const BY_NAME = new Map<string, Variable>(VARIABLES.map((v) => [v.name, v]))

export function variableEntry(name: VariableName): Variable {
  return BY_NAME.get(name)!
}

// In-process values set through `config`'s setters (tests point SITE_URL at
// a value without touching the real environment). They win over process.env.
const overrides = new Map<string, string>()

/** The raw value, exactly as set (or undefined). Read at call time. */
export function readVariable(name: VariableName): string | undefined {
  return overrides.has(name) ? overrides.get(name) : process.env[name]
}

/** Set an in-process value for this process only. Setting it back to what
 *  the environment holds (or undefined) clears it, so a test that saves and
 *  restores a value leaves no override behind. */
export function overrideVariable(name: VariableName, value: string | undefined): void {
  if (value === undefined || value === (process.env[name] ?? '')) overrides.delete(name)
  else overrides.set(name, value)
}

/** Run `fn` with a variable set in this process, then restore it. For the
 *  CLI's own rehearsals (people-plan's test-mode sign-in check). */
export async function withVariable<T>(name: VariableName, value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[name]
  process.env[name] = value
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
}

/** Set and not blank: an empty or whitespace-only value counts as missing
 *  (Railway allows ""). */
export function isSet(name: VariableName): boolean {
  return Boolean(readVariable(name)?.trim())
}

/** A variable whose name is DATA, not code: a Data Source's `url_env`, or a
 *  key the sales-target experiment reads. Not in the registry, because the
 *  instance decides the name; the release checks a source's (see
 *  release-preflight.ts). */
export function readNamedVariable(name: string): string | undefined {
  return process.env[name]
}

/** The environment a child process inherits, with `extra` on top. */
export function childEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra }
}

/** The whole environment, for functions that take one as a parameter so a
 *  test can pass its own (readSmtpConfig, preAuthPolicy). */
export function processEnvironment(): Record<string, string | undefined> {
  return process.env
}

/** Which environment this process runs as: FEATHERBASE_ENV, then NODE_ENV,
 *  then development. Blank counts as unset. */
export function currentEnvironment(): string {
  return (readVariable('FEATHERBASE_ENV')?.trim() || readVariable('NODE_ENV')?.trim() || 'development')
}

/** True when this process was told its environment rather than defaulting. */
export function environmentDeclared(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.FEATHERBASE_ENV?.trim() || env.NODE_ENV?.trim())
}

// ---------------------------------------------------------------- checks

export interface VariableReport {
  /** A switch on that this environment must never have. Each one stops a
   *  release and a server start. */
  forbidden: string[]
  /** A required variable missing. Each one stops a release and a server start. */
  refusals: string[]
  /** Each one is printed and lets the release go ahead. */
  warnings: string[]
  passed: string[]
}

export interface CheckVariablesOptions {
  environment: string
  /** Settings facts that make a `{ when }` variable required. Unknown at
   *  server start (no database read there), so those entries are skipped. */
  conditions?: ReadonlySet<SettingsCondition>
  /** Variables the instance's data names, each with why it is required. */
  named?: readonly { name: string; reason: string }[]
}

function active(v: Variable): boolean {
  const value = readVariable(v.name as VariableName)
  if (value === undefined || !value.trim()) return false
  return v.active ? v.active(value) : true
}

/** Is the feature this variable controls switched on (its `active` rule, or
 *  "set and not blank")? */
export function switchedOn(name: VariableName): boolean {
  return active(variableEntry(name))
}

/** Evaluate the registry for `environment` (D7). Pure: never throws. */
export function checkVariables(opts: CheckVariablesOptions): VariableReport {
  const { environment } = opts
  const dev = DEV_ENVIRONMENTS.includes(environment)
  const report: VariableReport = { forbidden: [], refusals: [], warnings: [], passed: [] }
  const missing = (v: Variable, extra?: string) =>
    `${v.name} is not set on a "${environment}" server.${extra ? ` (${extra})` : ''}${v.fix ? ` ${v.fix}` : ''}`
  for (const v of VARIABLES as readonly Variable[]) {
    const req = v.required
    if (req === 'optional') continue
    const set = isSet(v.name as VariableName)
    if (req === 'forbidden-in-production') {
      if (!active(v)) continue
      if ((v.allowedIn ?? TEST_MODE_ENVIRONMENTS).includes(environment)) report.passed.push(`${v.name} on, allowed on a "${environment}" server`)
      else report.forbidden.push(`${v.name} is set on a "${environment}" server. ${v.fix ?? ON_FORBIDDEN}`)
      continue
    }
    if (typeof req === 'object') {
      if (!opts.conditions?.has(req.when)) continue
      if (set) report.passed.push(`${v.name} set`)
      else if (dev) report.warnings.push(`WARNING: ${missing(v, `required while ${SETTINGS_CONDITIONS[req.when]}`)}`)
      else report.refusals.push(missing(v, `required while ${SETTINGS_CONDITIONS[req.when]}`))
      continue
    }
    if (set) report.passed.push(`${v.name} set`)
    else if (dev) report.passed.push(`${v.name} unset, allowed on a "${environment}" server`)
    else if (req === 'recommended') report.warnings.push(`WARNING: ${missing(v)}`)
    else report.refusals.push(missing(v))
  }
  for (const { name, reason } of opts.named ?? []) {
    if (readNamedVariable(name)?.trim()) report.passed.push(`${name} set (${reason})`)
    else if (dev) report.warnings.push(`WARNING: ${name} is not set on a "${environment}" server (${reason}).`)
    else report.refusals.push(`${name} is not set on a "${environment}" server (${reason}). Set it, or delete the data source.`)
  }
  return report
}

/** Throw every refusal at once, the forbidden switches first (they are the
 *  security finding), or return the warnings and passes. */
export function assertVariables(opts: CheckVariablesOptions): string[] {
  const report = checkVariables(opts)
  const all = [...report.forbidden, ...report.refusals]
  if (all.length) throw new Error(all.join('\n'))
  return [...report.warnings, ...report.passed]
}

// ---------------------------------------------------------------- .env

// EDS-1/BV7: for dev convenience an optional apps/server/.env (gitignored) is
// loaded once at import — KEY=VALUE lines only, never overriding variables
// already set by the shell. Values stay in process.env; nothing is persisted
// or logged.
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

/** The HTTP server's start-up refusal (index.ts): the same registry the
 *  release checks, with the settings-dependent requirements index.ts reads
 *  from the database (release-preflight.ts settingsRequirements). CLI commands
 *  never call this, so `cli settings:set` and `cli create-person` over
 *  `railway ssh` still run while a variable is missing (break-glass). Returns
 *  the warnings and passes to print. */
export function assertServerStart(
  environment: string = currentEnvironment(),
  fromSettings: Pick<CheckVariablesOptions, 'conditions' | 'named'> = {},
): string[] {
  return assertVariables({ environment, ...fromSettings })
}
