// The orb supervisor starts a new login shell, not a child of init.sh. Carry
// only the server's declared runtime configuration, never the shell's secrets.
import { constants, closeSync, fchmodSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { VARIABLES } from '../apps/server/src/env.ts'
import { DevError, instanceEnvironment, main as start } from './dev.mjs'

const names = [...new Set([...VARIABLES.map(({ name }) => name), 'API_PORT', 'WEB_PORT'])]
const [action, file] = process.argv.slice(2)

try {
  if (!file) throw new Error('Private environment file required')
  if (action === 'capture') {
    const env = instanceEnvironment()
    const declared = new Set(names)
    // init has migrated this database already. Its Data Sources and installed
    // app manifests own the dynamic names read through readNamedVariable.
    const { default: postgres } = createRequire(new URL('../apps/server/package.json', import.meta.url))('postgres')
    const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} })
    try {
      const sources = await sql`select url_env from featherbase.data_source where coalesce(trim(url_env), '') <> ''`
      for (const { url_env } of sources) declared.add(url_env)
      const apps = await sql`select manifest->'secrets' as secrets from featherbase.installed_app where jsonb_typeof(manifest->'secrets') = 'array'`
      for (const { secrets } of apps)
        for (const secret of secrets) declared.add(typeof secret === 'string' ? secret : secret.name)
    } finally { await sql.end({ timeout: 1 }) }
    const saved = Object.fromEntries([...declared].map((name) => [name, env[name] ?? null]))
    const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
    try {
      fchmodSync(fd, 0o600)
      writeFileSync(fd, JSON.stringify(saved))
    } finally { closeSync(fd) }
  } else if (action === 'start') {
    if ((statSync(file).mode & 0o077) !== 0) throw new Error('Environment file must be private')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    for (const name of new Set([...names, ...Object.keys(saved)])) {
      // Clear absent values too: supervisor defaults must not change the
      // configuration init prepared (including environment and app paths).
      delete process.env[name]
      if (typeof saved[name] === 'string') process.env[name] = saved[name]
    }
    await start([])
  } else throw new Error('Unknown supervised startup action')
} catch (error) {
  console.error(error instanceof DevError ? error.message : 'Featherbase supervised startup failed. Check the private configuration and service logs.')
  process.exitCode = 1
}
