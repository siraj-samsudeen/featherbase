#!/usr/bin/env node
// `pnpm dev <client>/<instance>`: from nothing to a running instance, on Windows,
// macOS and Linux. Needs only Node, pnpm and a running Postgres. Every step is
// safe to repeat. ./init.sh remains the separate boot-and-smoke path.
//
//   pnpm dev jeyarama/dash [--check] [--environment <section>]
//
// --check stops after proving the server answers and the apps are installed.
// --environment picks the settings file's section (default: local).
//
// Database work happens before the servers start: an install or an apply from
// another process would not reach a running server's in-memory caches.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'

export class DevError extends Error {}

/** Every `<client>/<instance>` folder under client-apps. */
export function listInstances(base = root) {
  const clients = join(base, 'client-apps')
  if (!existsSync(clients)) return []
  return readdirSync(clients, { withFileTypes: true }).filter((c) => c.isDirectory()).flatMap((c) => {
    const folder = join(clients, c.name, 'instances')
    return existsSync(folder)
      ? readdirSync(folder, { withFileTypes: true })
          .filter((i) => i.isDirectory() && existsSync(join(folder, i.name, 'instance.json')))
          .map((i) => `${c.name}/${i.name}`)
      : []
  }).sort()
}

/** The instance a command names: its folder, settings file and apps. */
export function resolveInstance(name, base = root) {
  const known = listInstances(base)
  if (!known.includes(name))
    throw new DevError(`No instance "${name ?? ''}". Name one of: ${known.join(', ') || '(none)'}, as in: pnpm dev ${known[0] ?? '<client>/<instance>'}`)
  const [client, instance] = name.split('/')
  const folder = join(base, 'client-apps', client, 'instances', instance)
  const declared = JSON.parse(readFileSync(join(folder, 'instance.json'), 'utf8'))
  if (!Array.isArray(declared.apps) || !declared.apps.length) throw new DevError(`${name}: instance.json lists no apps`)
  const apps = declared.apps.map((path) => {
    const appRoot = join(base, ...path.split('/'))
    const manifest = join(appRoot, 'featherbase.json')
    if (!existsSync(manifest)) throw new DevError(`${name}: instance.json lists ${path}, which has no featherbase.json`)
    return { path, root: appRoot, name: JSON.parse(readFileSync(manifest, 'utf8')).name }
  })
  return { name, client, instance, settingsFile: join(folder, 'instance-settings.json'), apps }
}

/** Flags and the instance name. */
export function parseCommand(argv) {
  const out = { instance: undefined, check: false, environment: 'local' }
  const args = argv.filter((a) => a !== '--')
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') out.check = true
    else if (args[i] === '--environment') {
      out.environment = args[++i]
      if (!out.environment) throw new DevError('--environment takes a section of the settings file, such as dev')
    } else if (args[i].startsWith('--')) throw new DevError(`Unknown option ${args[i]}`)
    else if (out.instance) throw new DevError(`Name one instance, not "${out.instance}" and "${args[i]}"`)
    else out.instance = args[i]
  }
  return out
}

/** This command only ever targets a developer's own database and server. */
export function assertLocal(env) {
  for (const name of ['FEATHERBASE_ENV', 'NODE_ENV'])
    if (env[name] && env[name] !== 'development')
      throw new DevError(`${name} is "${env[name]}". pnpm dev is for development only: unset it.`)
  const { hostname } = new URL(env.DATABASE_URL)
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname))
    throw new DevError(`DATABASE_URL points at ${hostname}. pnpm dev migrates and rewrites its database, so it only uses one on this machine.`)
}

/** What to tell someone whose Postgres won't answer. Never holds the password. */
export function postgresHelp(error, url, platform = process.platform) {
  const u = new URL(url)
  const at = `${u.hostname}:${u.port || 5432}`
  if (error.code === '28P01' || error.code === '28000')
    return `Postgres at ${at} refused user "${decodeURIComponent(u.username)}" and that password. Set DATABASE_URL in .env.local to a login that works, for example postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/${u.pathname.slice(1)}`
  const start = platform === 'win32'
    ? 'On Windows, open Services and start "postgresql-x64-<version>", or install PostgreSQL from https://www.postgresql.org/download/windows/ (use the password postgres, or put your own in DATABASE_URL in .env.local).'
    : platform === 'darwin'
      ? 'On macOS: brew services start postgresql@18 (or your version).'
      : 'On Linux: sudo systemctl start postgresql.'
  return `Can't reach Postgres at ${at} (${error.code ?? error.message}). ${start} Then run this again. To use another server on this machine, set DATABASE_URL in .env.local.`
}

// ------------------------------------------------------------- running things

// Node refuses to spawn a .cmd without a shell, and npm and pnpm are .cmd files
// on Windows. Every argument given to these is a plain word or a relative path.
function runTool(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: isWindows, ...options })
  if (result.error) throw new DevError(`Could not run ${command}: ${result.error.message}`)
  if (result.status !== 0) throw new DevError(`${command} ${args.join(' ')} failed (exit ${result.status})`)
}

// node directly, with no shell, so an absolute path may hold spaces.
function serverCommand(env, ...args) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: join(root, 'apps/server'), env, stdio: 'inherit' })
  if (result.error) throw new DevError(`Could not run the server's CLI: ${result.error.message}`)
  if (result.status !== 0) throw new DevError(`cli ${args[0]} failed (exit ${result.status}); see above`)
}

function step(text) {
  console.log(`\n==> ${text}`)
}

function loadEnvLocal() {
  const file = join(root, '.env.local')
  if (!existsSync(file)) return
  // process.loadEnvFile leaves a variable already set alone, so a real one wins.
  // A blank line in the file (`DIVE_ID=`) must not count as a value either way.
  const before = new Set(Object.keys(process.env))
  process.loadEnvFile(file)
  for (const key of Object.keys(process.env)) if (!before.has(key) && process.env[key] === '') delete process.env[key]
}

/** npm's own environment, as tools/prepare-apps.mjs explains. */
function npmEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^npm_config_/i.test(key)))
}

function buildApp(app, env) {
  const npmEnv = npmEnvironment(env)
  const lock = join(app.root, 'package-lock.json')
  const installed = join(app.root, 'node_modules', '.package-lock.json')
  // .bin too: an install killed partway leaves the marker and an empty folder.
  if (existsSync(lock) && (!existsSync(installed) || !existsSync(join(app.root, 'node_modules', '.bin')) || statSync(installed).mtimeMs < statSync(lock).mtimeMs))
    runTool('npm', ['ci', '--ignore-scripts'], { cwd: app.root, env: npmEnv })
  runTool('npm', ['run', 'build'], { cwd: app.root, env: npmEnv })
}

async function ensureDatabase(env) {
  const postgres = createRequire(join(root, 'apps/server/package.json'))('postgres')
  const target = new URL(env.DATABASE_URL)
  const name = decodeURIComponent(target.pathname.slice(1))
  const admin = new URL(target)
  admin.pathname = '/postgres'
  const sql = postgres(admin.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} })
  try {
    const [found] = await sql`select 1 from pg_database where datname = ${name}`
    if (found) console.log(`database ${name} exists`)
    else {
      await sql`create database ${sql(name)}`
      console.log(`created database ${name}`)
    }
  } catch (error) {
    throw new DevError(postgresHelp(error, env.DATABASE_URL))
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {})
  }
}

function assertPortFree(port, variable) {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', () => fail(new DevError(`Port ${port} is in use. Stop whatever holds it, or set ${variable} to another port.`)))
    probe.listen(port, () => probe.close(() => done()))
  })
}

function startChild(label, script, args, cwd, env) {
  // Its own process group on macOS and Linux, so stopping it stops what it
  // started (tsx watch runs the server as a child).
  const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ['ignore', 'inherit', 'inherit'], detached: !isWindows })
  child.label = label
  return child
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

async function waitForAnswer(url, what, seconds = 90) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new DevError(`${what} did not answer at ${url} within ${seconds}s; see its output above`)
}

/** --check: the server answers, every app is installed and its page serves. */
async function verify(instance, env) {
  const api = `http://127.0.0.1:${env.API_PORT}`
  const web = `http://localhost:${env.WEB_PORT}`
  const login = await fetch(`${api}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usr: 'Administrator', pwd: 'admin' }) })
  if (!login.ok) throw new DevError(`Signing in as Administrator failed (HTTP ${login.status})`)
  const { token } = await login.json()
  const listing = await fetch(`${api}/api/apps`, { headers: { authorization: `Bearer ${token}` } })
  if (!listing.ok) throw new DevError(`Listing apps failed (HTTP ${listing.status})`)
  const { installed } = await listing.json()
  for (const app of instance.apps) {
    if (!installed.some((row) => row.name === app.name)) throw new DevError(`${app.name} is not installed`)
    // Signed in: signed out, every address redirects to the login page.
    const page = await fetch(`${web}/${app.name}/`, { headers: { authorization: `Bearer ${token}` } })
    if (!page.ok) throw new DevError(`${web}/${app.name}/ answered HTTP ${page.status}`)
    console.log(`check: ${app.name} is installed and its page serves`)
  }
}

async function main(argv) {
  const command = parseCommand(argv)
  const instance = resolveInstance(command.instance)
  loadEnvLocal()
  const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || `postgres://postgres:postgres@127.0.0.1:5432/fb_${instance.client}_${instance.instance}`,
    API_PORT: process.env.API_PORT || '8000',
    WEB_PORT: process.env.WEB_PORT || '5173',
    FEATHERBASE_APP_PATHS: JSON.stringify(instance.apps.map((app) => app.root)),
    // The mock Google sign-in, for a developer's machine: assertLocal holds this
    // to development, and the server refuses it anywhere else.
    ALLOW_MOCK_OAUTH: '1',
  }
  env.PORT = env.API_PORT
  assertLocal(env)
  await assertPortFree(env.API_PORT, 'API_PORT')
  await assertPortFree(env.WEB_PORT, 'WEB_PORT')

  step('Installing dependencies')
  runTool('pnpm', ['install'], { cwd: root, env })
  step(`Building ${instance.apps.map((app) => app.path).join(', ')}`)
  for (const app of instance.apps) buildApp(app, env)
  step('Preparing the database')
  await ensureDatabase(env)
  serverCommand(env, 'migrate')
  // Before the settings: an App Setting row names an installed app.
  step('Installing apps')
  for (const app of instance.apps) serverCommand(env, 'install-app', app.name)
  step(`Applying the settings file (${command.environment})`)
  serverCommand(env, 'settings:apply', '--file', instance.settingsFile, '--environment', command.environment)

  step('Starting the API and the web app')
  const server = join(root, 'apps/server')
  const web = join(root, 'apps/web')
  const children = [
    startChild('API', join(server, 'node_modules/tsx/dist/cli.mjs'), ['watch', 'src/index.ts'], server, env),
    startChild('web', join(web, 'node_modules/vite/bin/vite.js'), [], web, env),
  ]
  let stopping = false
  const stop = (code) => {
    if (stopping) return
    stopping = true
    children.forEach(stopChild)
    setTimeout(() => process.exit(code), 1000).unref?.()
    Promise.all(children.map((c) => (c.exitCode !== null || c.signalCode !== null ? null : new Promise((r) => c.once('exit', r))))).then(() => process.exit(code))
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', ...(isWindows ? ['SIGBREAK'] : [])]) process.on(signal, () => stop(0))
  for (const child of children)
    child.once('exit', (code) => {
      if (stopping) return
      console.error(`!! the ${child.label} stopped (exit ${code}); stopping everything`)
      stop(1)
    })

  try {
    await waitForAnswer(`http://127.0.0.1:${env.API_PORT}/api/ping`, 'The API')
    await waitForAnswer(`http://localhost:${env.WEB_PORT}/`, 'The web app')
    if (command.check) {
      await verify(instance, env)
      console.log(`\n==> ${instance.name} check passed`)
      stop(0)
      return
    }
  } catch (error) {
    console.error(`!! ${error.message}`)
    stop(1)
    return
  }
  const first = instance.apps[0].name
  console.log(`\n==> ${instance.name} is running. Ctrl-C stops it.`)
  console.log(`    Sign in:  http://localhost:${env.WEB_PORT}/featherbase/login  as Administrator / admin (development only)`)
  for (const app of instance.apps) console.log(`    ${app.name === first ? 'Open:    ' : 'Also:    '} http://localhost:${env.WEB_PORT}/${app.name}/`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\n!! ${error instanceof DevError ? error.message : error.stack ?? error}`)
    process.exit(1)
  })
}
