#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DevError, instanceEnvironment, main as start, prepareInstance, resetInstance, resolveInstance } from './dev.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const groups = {
  database: ['migrate', 'migrate:rehearse', 'seed', 'create-table'],
  people: ['create-person', 'set-password', 'create-service-account', 'issue-token', 'list-tokens', 'revoke-token'],
  apps: ['install-app', 'repin-apps', 'seed-pack'],
  settings: ['settings:set', 'settings:apply', 'settings:export', 'settings:variables', 'settings:compare'],
  operations: ['boot-check', 'mail:test', 'leavers:check', 'console'],
}
const help = {
  root: `Featherbase — your local platform

  setup   Prepare the platform database; safe to repeat.
          featherbase setup
  start   Start the API and web app; Ctrl-C stops them.
          featherbase start
  health  Report readiness, optional setup and operational faults.
          featherbase health [--json]
  reset   Start clean: preview deletion; --yes confirms it.
          featherbase reset [<client>/<instance>] [--yes]

Start here: setup, then start, then sign in as Administrator / admin (local development only).
Next: featherbase <command> --help
Advanced administration: featherbase advanced --help
Not registered? From the checkout use pnpm featherbase <command> instead.`,
  setup: `featherbase setup
Prepare only the local platform database. No apps are built or installed.
Repeat safely: existing data and installed apps remain. Uses DATABASE_URL from
the environment or .env.local; default database: featherbase on local Postgres.
Next: featherbase start`,
  start: `featherbase start [<client>/<instance>] [--check] [--made-up-data] [--environment <section>]
Start Featherbase with reload. No instance name means platform only: no app builds
or installs. Existing installed apps remain. Ctrl-C stops the API and web app.
--check verifies startup then stops. Named instances explicitly build/install their apps.
Next: open the printed sign-in address, or run featherbase health.`,
  health: `featherbase health [--json]
Read the same server-owned checks used by the browser; no changes or prompts.
Exit 0 means ready to explore; exit 1 means an operational fault or required setup.
Uses the same DATABASE_URL / .env.local selection as setup and start.
Next: follow each finding's next action, then run featherbase health again.`,
  reset: `featherbase reset [<client>/<instance>] [--yes]
Start clean: remove only the selected local development database and isolated
uploads. Without --yes, describe the target and file count, change nothing and
exit 1. Stop connected servers first; reset never kills them or runs setup.
Refuses remote targets, non-development database stamps and custom/shared storage.
Legacy shared uploads are never deleted. Uses setup/start's DATABASE_URL selection.
Next: featherbase setup`,
}

function advancedHelp(group) {
  const selected = group ? { [group]: groups[group] } : groups
  if (group && !groups[group]) throw new DevError(`Unknown administration group ${group}. Run featherbase advanced --help`)
  return `Featherbase advanced administration\n\n${Object.entries(selected).map(([name, commands]) =>
    `  ${name}: ${commands.join(', ')}\n    featherbase advanced ${name} <command> [arguments]`).join('\n\n')}

Existing server command arguments are documented at apps/server/src/cli.ts.
Mutations target the selected DATABASE_URL. Commands requiring input use stdin;
console requires an interactive terminal. Apps are installed only by explicit name.`
}

async function main(argv) {
  const [action, ...args] = argv.filter((arg) => arg !== '--')
  if (!action || action === '--help' || action === 'help') return console.log(help.root)
  if (!['setup', 'start', 'health', 'reset', 'advanced'].includes(action)) throw new DevError(`Unknown command "${action}". Run featherbase --help`)
  if (action === 'advanced') {
    const [group, operation, ...rest] = args
    if (!group || group === '--help') return console.log(advancedHelp())
    if (!operation || operation === '--help') return console.log(advancedHelp(group))
    if (!groups[group]?.includes(operation)) throw new DevError(`Unknown command in ${group}. Run featherbase advanced --help`)
    if (rest.includes('--help')) return console.log(advancedHelp(group))
    if (operation === 'console' && !process.stdin.isTTY) throw new DevError('Console needs an interactive terminal. Run featherbase advanced --help')
    return delegate([operation, ...rest], true)
  }
  if (args.includes('--help')) return console.log(help[action])
  if (action === 'start') return start(args)
  if (action === 'reset') {
    let name
    for (const arg of args) {
      if (arg === '--yes') continue
      if (arg.startsWith('-')) throw new DevError(`Unknown option ${arg}. Run featherbase reset --help`)
      if (name) throw new DevError('Name only one instance. Run featherbase reset --help')
      name = arg
    }
    const instance = resolveInstance(name)
    return resetInstance(instance, instanceEnvironment(instance), args.includes('--yes'))
  }
  for (const arg of args) if (action !== 'health' || arg !== '--json') throw new DevError(`Unknown option ${arg}. Run featherbase ${action} --help`)
  if (action === 'health') return delegate(['health', ...args])
  await prepareInstance(resolveInstance(), { ...instanceEnvironment(), ALLOW_MOCK_OAUTH: '1' })
}

function delegate(args, mutation = false) {
  const env = instanceEnvironment()
  if (mutation) {
    const target = new URL(env.DATABASE_URL)
    console.error(`Target: database ${decodeURIComponent(target.pathname.slice(1))} on ${target.hostname}:${target.port || 5432}`)
  }
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: join(root, 'apps/server'), env, stdio: 'inherit',
  })
  if (result.error) throw new DevError('Could not start Featherbase. Run pnpm install, then try again.')
  process.exitCode = result.status ?? 1
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`Featherbase: ${error.message}`)
  process.exitCode = 1
})
