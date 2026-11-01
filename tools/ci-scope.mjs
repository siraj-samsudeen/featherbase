#!/usr/bin/env node
// Decides which CI suites a change needs (ADR 0014 section 5). Reads the
// changed paths, one per line, from stdin and appends key=value lines to
// $GITHUB_OUTPUT. Anything it does not recognise runs everything, and a failure
// here runs everything too: test.yml treats a missing answer as "run it".
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const EVERYTHING = new Set(['server', 'web', 'e2e', 'client', 'example'])
const TEMPLATE_FILES = new Set(['.copier-answers.yml', 'opencode.json', 'skills-lock.json', 'scripts/create-labels.sh'])

/** The suites one changed path needs. An empty set is docs: the fast checks only. */
export function suitesFor(path) {
  // Read by the server suite and by check:env, so not prose.
  if (path === 'docs/DEPLOY.md') return new Set(['server', 'client'])
  // A spec's fenced Gherkin is the acceptance suite's source, and that suite
  // runs in the e2e job (#738), so neither is prose.
  if (/^openspec\/.*\/spec\.md$/.test(path)) return new Set(['e2e'])
  if (path.startsWith('acceptance-tests/') && !path.endsWith('.md')) return new Set(['e2e'])
  const prose = path.endsWith('.md') && !path.includes('/fixtures/') && !/^client-apps\/[^/]+\/instances\//.test(path)
  if (prose || /^(docs|openspec|\.claude|\.agents|\.amp)\//.test(path) || path === 'LICENSE') return new Set()
  // The shared process template's files, which `copier update` brings (#753).
  if (path.startsWith('.opencode/') || TEMPLATE_FILES.has(path)) return new Set()
  if (path.startsWith('client-apps/')) return new Set(['client'])
  if (path.startsWith('example-apps/')) return new Set(['example'])
  if (path.startsWith('apps/server/')) return new Set(['server', 'client'])
  if (path.startsWith('apps/web/')) return new Set(['web', 'e2e'])
  return EVERYTHING
}

/**
 * The answer for test.yml. Only a pull request is ever scoped; `run-all` is the
 * way to ask for everything on one, `run-e2e` for e2e alone. No changed paths
 * means the diff told us nothing, so everything runs.
 */
export function decide({ event, labels = [], files }) {
  const scoped = event === 'pull_request' && !labels.includes('run-all') && files.length > 0
  const suites = new Set(scoped ? files.flatMap(file => [...suitesFor(file)]) : EVERYTHING)
  if (scoped && labels.includes('run-e2e')) suites.add('e2e')
  const server = suites.has('server')
  const web = suites.has('web')
  const e2e = suites.has('e2e')
  return {
    // Everything beyond the fast checks: building the apps and both typechecks.
    platform_checks: server || web,
    server,
    web,
    e2e,
    client_apps: suites.has('client'),
    // Tasker's own layers, unless the full web and e2e suites already run them.
    tasker_tests: suites.has('example') && !(web && e2e),
    // Merges the web and browser reports, so it needs both to have run.
    coverage_merged: web && e2e,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean)
  const decision = decide({ event: process.env.EVENT, labels: JSON.parse(process.env.LABELS || '[]') ?? [], files })
  const lines = Object.entries(decision).map(([key, value]) => `${key}=${value}`)
  console.log(`${files.length} changed path(s)\n${lines.join('\n')}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('  \n')}\n`)
}
