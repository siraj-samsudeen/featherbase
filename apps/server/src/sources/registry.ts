import { sql } from '../db'
import { AppError } from '../errors'
import type { SourceConfig, SourceDriver, SourceEngine } from './types'
import { postgresDriver } from './postgres-driver'
import { mysqlDriver } from './mysql-driver'
import { duckdbDriver } from './duckdb-driver'
import { csvFolderDriver } from './csv-driver'

// EDS-1: the Data Source registry. Rows live in the control DB (physical
// table data_source); this cache mirrors the meta cache's lifecycle — any
// Data Source save must call invalidateSources() (the Data Source controller
// does), which also drops driver pools so new settings apply without a
// restart (spec S1/S3).

const cache = new Map<string, SourceConfig>()

const DRIVERS: Record<SourceEngine, SourceDriver> = {
  postgres: postgresDriver,
  mysql: mysqlDriver,
  duckdb: duckdbDriver,
  'csv-folder': csvFolderDriver,
}

export function invalidateSources(name?: string) {
  const names = name ? [name] : [...cache.keys()]
  for (const n of names) {
    const cfg = cache.get(n)
    if (cfg) DRIVERS[cfg.engine].dispose(n)
    cache.delete(n)
  }
  // A renamed/new source has no cache entry yet — dispose in every driver so
  // a stale pool can't outlive a config it no longer matches.
  if (name) for (const d of Object.values(DRIVERS)) d.dispose(name)
}

function parseAllowlist(raw: unknown): string[] | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const entries = text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return entries.length ? entries : null
}

export async function getSource(name: string): Promise<SourceConfig> {
  const cached = cache.get(name)
  if (cached) return cached
  const [row] = await sql`select * from data_source where name = ${name}`
  if (!row) throw new AppError('NotFoundError', `Data Source ${name} not found`)
  const engine = String(row.engine) as SourceEngine
  if (!(engine in DRIVERS))
    throw new AppError('ValidationError', `Unknown data source engine ${engine}`)
  const cfg: SourceConfig = {
    name,
    engine,
    url_env: (row.url_env as string | null) || null,
    root_path: (row.root_path as string | null) || null,
    default_schema: (row.default_schema as string | null) || null,
    access: row.access === 'read_write' ? 'read_write' : 'read_only',
    pool_max: Math.min(Math.max(Number(row.pool_max ?? 5) || 5, 1), 20),
    statement_timeout_ms: Math.min(
      Math.max(Number(row.statement_timeout_ms ?? 10000) || 10000, 100),
      60000,
    ),
    allowlist: parseAllowlist(row.table_allowlist),
  }
  cache.set(name, cfg)
  return cfg
}

export function getDriver(cfg: SourceConfig): SourceDriver {
  return DRIVERS[cfg.engine]
}

// EDS-1: credentials are resolved from the environment at connect time and
// never persisted. A missing variable names itself and never falls back.
export function resolveUrl(cfg: SourceConfig): string {
  if (!cfg.url_env)
    throw new AppError('ValidationError', `Data source ${cfg.name} has no url_env configured`)
  const value = process.env[cfg.url_env]
  if (!value)
    throw new AppError(
      'ValidationError',
      `Environment variable ${cfg.url_env} is not set (required by data source ${cfg.name})`,
    )
  return value
}

export function assertAllowed(cfg: SourceConfig, schema: string, table: string): void {
  if (!cfg.allowlist) return
  const qualified = schema ? `${schema}.${table}` : table
  if (!cfg.allowlist.includes(qualified))
    throw new AppError(
      'PermissionError',
      `Table ${qualified} is not in the allowlist of data source ${cfg.name}`,
    )
}

// EDS-1: Test Connection. Stamps conn_status/last_checked_at/last_error on
// the row directly (they are read_only columns, system-managed).
export async function testSource(name: string): Promise<{ ok: boolean; error?: string }> {
  invalidateSources(name)
  const cfg = await getSource(name)
  const driver = getDriver(cfg)
  try {
    await driver.test(cfg)
    await sql`update data_source set conn_status = 'ok', last_checked_at = ${new Date()},
      last_error = null where name = ${name}`
    return { ok: true }
  } catch (err) {
    // Never echo a connection string: driver errors can embed the URL.
    const message = scrubSecrets(cfg, err instanceof Error ? err.message : String(err))
    await sql`update data_source set conn_status = 'error', last_checked_at = ${new Date()},
      last_error = ${message} where name = ${name}`
    return { ok: false, error: message }
  }
}

function scrubSecrets(cfg: SourceConfig, message: string): string {
  const secret = cfg.url_env ? process.env[cfg.url_env] : undefined
  if (!secret) return message
  let out = message.split(secret).join(`$${cfg.url_env}`)
  // Also scrub the password portion of a URL-shaped secret on its own.
  const pwd = /^[a-z+]+:\/\/[^:/@]+:([^@]+)@/i.exec(secret)?.[1]
  if (pwd) out = out.split(pwd).join('****')
  return out
}
