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

export const config = {
  port: Number(process.env.PORT ?? 8000),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://postgres:postgres@127.0.0.1:5432/featherbase',
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
