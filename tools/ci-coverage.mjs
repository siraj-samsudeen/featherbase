// `pnpm coverage:ci` (#1201): the merged coverage CI would report, made on
// this machine the way CI makes it (.github/workflows/test.yml). The server
// runs three shards and the release preflight with thresholds zeroed, then
// merges their blobs under the real thresholds (coverage-server); the web runs
// its four component shards through tools/ci-shards.mjs and merges them
// (unit-web). Each run gets a fresh database of its own on the local
// Postgres, with a password in its address as CI's has; every one is dropped
// afterwards. Local Postgres only: no MySQL (owner's choice, #1201).
//
//   pnpm coverage:ci [--only=server|web] [--jobs=N]
//
// COVERAGE_CI_POSTGRES overrides the server address (default
// postgres://<you>:ci@127.0.0.1:5432; local trust auth ignores the password).
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { userInfo } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const ZEROED = ['lines', 'statements', 'functions', 'branches'].map(m => `--coverage.thresholds.${m}=0`)

/** What to run, as CI runs it. Pure, so the shape is tested (ci-coverage.test.mjs). */
export function plan(base, runId) {
  const env = database => ({ DATABASE_URL: `${base}/${database}`, NODE_ENV: 'test', ALLOW_MOCK_OAUTH: '1' })
  const db = name => `coverage_ci_${runId}_${name}`
  const shard = n => {
    const database = db(`server_${n}`)
    return { name: `shard ${n}/3`, database, env: env(database), args: ['vitest', 'run', '--coverage', ...ZEROED,
      `--shard=${n}/3`, `--coverage.reportsDirectory=coverage/shard-${n}`,
      '--reporter=dot', '--reporter=blob', `--outputFile.blob=.vitest-reports/blob-${n}.json`] }
  }
  const preflight = db('server_preflight')
  return {
    server: {
      runs: [shard(1), shard(2), shard(3), { name: 'release preflight', database: preflight, env: env(preflight),
        args: ['vitest', 'run', 'test/release-preflight.test.ts', '--coverage', ...ZEROED,
          '--coverage.reportsDirectory=coverage/shard-preflight', '--reporter=dot', '--reporter=blob', '--outputFile.blob=.vitest-reports/release-pg18.json'] }],
      merge: ['vitest', 'run', '--merge-reports=.vitest-reports', '--coverage'],
    },
    web: {
      runs: [1, 2, 3, 4].map(n => {
        const database = db(`web_${n}`)
        return { name: `component ${n}/4`, database, env: env(database), args: ['tools/ci-shards.mjs', 'run', 'component', String(n)] }
      }),
      collect: ['tools/ci-shards.mjs', 'collect', 'component'],
      merge: ['vitest', 'run', '--merge-reports=.vitest-web-reports', '--coverage'],
    },
  }
}

const logs = resolve(root, '.coverage-ci')

/** Runs a command; its output goes to .coverage-ci/<log>.log. Resolves to the exit code. */
function run(command, args, { env = {}, log }) {
  mkdirSync(logs, { recursive: true })
  const out = createWriteStream(resolve(logs, `${log}.log`))
  return new Promise(done => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env } })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    child.on('close', code => { out.end(); done(code ?? 1) })
  })
}

async function pool(items, jobs, work) {
  const results = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await work(items[i]) }
  }))
  return results
}

function summary(app) {
  const file = resolve(root, `apps/${app}/coverage/coverage-summary.json`)
  if (!existsSync(file)) return `  ${app}: no summary written`
  const total = JSON.parse(readFileSync(file, 'utf8')).total
  return ['lines', 'statements', 'functions', 'branches']
    .map(m => `  ${app} ${m.padEnd(10)} ${String(total[m].total - total[m].covered).padStart(4)} uncovered of ${total[m].total}`).join('\n')
}

async function main(argv) {
  const only = argv.find(a => a.startsWith('--only='))?.slice(7)
  const jobs = Number(argv.find(a => a.startsWith('--jobs='))?.slice(7)) || 3
  const base = process.env.COVERAGE_CI_POSTGRES ?? `postgres://${userInfo().username}:ci@127.0.0.1:5432`
  const p = plan(base, Date.now().toString(36))
  const suites = only ? [only] : ['server', 'web']
  const databases = suites.flatMap(s => p[s].runs.map(r => r.database))
  const admin = `${base}/postgres`
  const failures = []
  const merged = []
  console.log(`coverage:ci, as CI makes it (logs in .coverage-ci/); local Postgres, no MySQL`)
  try {
    for (const database of databases) if (await run('createdb', [`--maintenance-db=${admin}`, database], { log: `createdb-${database}` }))
      throw new Error(`could not create ${database} on ${base}`)

    if (suites.includes('server')) {
      rmSync(resolve(root, 'apps/server/.vitest-reports'), { recursive: true, force: true })
      const codes = await pool(p.server.runs, jobs, async r => {
        const migrated = await run('pnpm', ['--filter', 'server', 'migrate'], { env: r.env, log: `migrate-${r.database}` })
        const code = migrated || await run('pnpm', ['--filter', 'server', 'exec', ...r.args], { env: r.env, log: `server-${r.name.replace(/\W+/g, '-')}` })
        console.log(`  server ${r.name}: ${code ? 'FAILED' : 'ok'}`)
        return code
      })
      if (codes.some(Boolean)) failures.push('a server run failed')
      else if (await run('pnpm', ['--filter', 'server', 'exec', ...p.server.merge], { log: 'server-merge' })) failures.push('the server merge (coverage thresholds)')
      else merged.push('server')
    }

    if (suites.includes('web')) {
      rmSync(resolve(root, '.ci-shards'), { recursive: true, force: true })
      const codes = await pool(p.web.runs, jobs, async r => {
        const code = await run('node', r.args, { env: r.env, log: `web-${r.name.replace(/\W+/g, '-')}` })
        console.log(`  web ${r.name}: ${code ? 'FAILED' : 'ok'}`)
        return code
      })
      if (codes.some(Boolean)) failures.push('a web run failed')
      else if (await run('node', p.web.collect, { log: 'web-collect' })) failures.push('collecting the web shards')
      else if (await run('pnpm', ['--filter', 'web', 'exec', ...p.web.merge], { log: 'web-merge' })) failures.push('the web merge (coverage thresholds)')
      else merged.push('web')
    }
  } finally {
    for (const database of databases)
      for (const name of [database, `${database}_ext`])
        await run('dropdb', [`--maintenance-db=${admin}`, '--if-exists', name], { log: `dropdb-${name}` })
  }
  // Only a merged report is CI's number; a shard's own report is a fraction of it.
  if (merged.length) console.log(merged.map(summary).join('\n'))
  if (failures.length) {
    console.error(`coverage:ci failed: ${failures.join('; ')}. See .coverage-ci/.`)
    process.exitCode = 1
  } else console.log('coverage:ci: every run and merge passed')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2))
