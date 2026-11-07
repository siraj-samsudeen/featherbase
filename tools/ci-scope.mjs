#!/usr/bin/env node
// Decides which CI suites a change needs (ADR 0014 section 5). Reads the
// changed paths, one per line, from stdin and appends key=value lines to
// $GITHUB_OUTPUT. Anything it does not recognise runs everything, and a failure
// here runs everything too: test.yml treats a missing answer as "run it".
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { acceptanceShardCount } from './ci-shards.mjs'

const EVERYTHING = new Set(['server', 'web', 'browser', 'acceptance', 'client', 'example'])
const TEMPLATE_FILES = new Set(['.copier-answers.yml', 'opencode.json', 'skills-lock.json', 'scripts/create-labels.sh'])

// A spec's capability, when it is one the acceptance suite can run alone. An
// archived spec never runs; a spec anywhere unexpected has no capability.
const CAPABILITY = /^openspec\/(?:specs|changes\/(?!archive\/)[^/]+\/specs)\/([^/]+)\/spec\.md$/

/** The suites one changed path needs. An empty set is docs: the fast checks only. */
export function suitesFor(path) {
  // Read by the server suite and by check:env, so not prose.
  if (path === 'docs/DEPLOY.md') return new Set(['server', 'client'])
  // A spec's fenced Gherkin is the acceptance suite's source, and nothing else
  // reads it, so it runs its own scenarios only (#995).
  if (path.startsWith('openspec/changes/archive/')) return new Set()
  if (CAPABILITY.test(path)) return new Set(['capability'])
  if (/^openspec\/.*\/spec\.md$/.test(path)) return new Set(['acceptance'])
  if (path.startsWith('acceptance-tests/') && !path.endsWith('.md')) return new Set(['acceptance'])
  const prose = path.endsWith('.md') && !path.includes('/fixtures/') && !/^client-apps\/[^/]+\/instances\//.test(path)
  if (prose || /^(docs|openspec|\.claude|\.agents|\.amp)\//.test(path) || path === 'LICENSE') return new Set()
  // The shared process template's files, which `copier update` brings (#753).
  if (path.startsWith('.opencode/') || TEMPLATE_FILES.has(path)) return new Set()
  if (path.startsWith('client-apps/')) return new Set(['client'])
  if (path.startsWith('example-apps/')) return new Set(['example'])
  if (path.startsWith('apps/server/')) return new Set(['server', 'client'])
  if (path.startsWith('apps/web/')) return new Set(['web', 'browser', 'acceptance'])
  // A workflow runs on its own triggers; only this one changes what runs here.
  if (/^\.github\/workflows\//.test(path) && path !== '.github/workflows/test.yml') return new Set()
  return EVERYTHING
}

/**
 * The answer for test.yml. Only a pull request is ever scoped; `run-all` is the
 * way to ask for everything on one, `run-e2e` for e2e alone. No changed paths
 * means the diff told us nothing, so everything runs. `hasScenarios` says
 * whether a capability has any Gherkin to run.
 */
export function decide({ event, labels = [], files, hasScenarios = () => true }) {
  const scoped = event === 'pull_request' && !labels.includes('run-all') && files.length > 0
  const suites = new Set(scoped ? files.flatMap(file => [...suitesFor(file)]) : EVERYTHING)
  if (scoped && labels.includes('run-e2e')) { suites.add('browser'); suites.add('acceptance') }
  const server = suites.has('server')
  const web = suites.has('web')
  const browser = suites.has('browser')
  const allAcceptance = suites.has('acceptance')
  const capabilities = allAcceptance ? [] : [...new Set(files.map(file => CAPABILITY.exec(file)?.[1]).filter(Boolean))].filter(hasScenarios).sort()
  return {
    // Everything beyond the fast checks: building the apps and both typechecks.
    platform_checks: server || web,
    server,
    web,
    browser,
    acceptance: allAcceptance || capabilities.length > 0,
    // Empty when all of acceptance runs: this only ever narrows it.
    acceptance_capabilities: capabilities.join(','),
    client_apps: suites.has('client'),
    // Tasker's own layers, unless the full web and e2e suites already run them.
    tasker_tests: suites.has('example') && !(web && browser && allAcceptance),
    // Merges the web, browser and acceptance reports, so it needs all to have run.
    coverage_merged: web && browser && allAcceptance,
  }
}

/** Whether a capability's spec, or an active change's delta to it, has a Gherkin fence. */
function capabilityHasGherkin(capability) {
  const changes = existsSync('openspec/changes') ? readdirSync('openspec/changes').filter(name => name !== 'archive') : []
  return ['openspec/specs', ...changes.map(change => `openspec/changes/${change}/specs`)]
    .map(directory => `${directory}/${capability}/spec.md`)
    .some(file => existsSync(file) && /^\s*`{3,}gherkin\s*$/m.test(readFileSync(file, 'utf8')))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean)
  const decision = decide({ event: process.env.EVENT, labels: JSON.parse(process.env.LABELS || '[]') ?? [], files, hasScenarios: capabilityHasGherkin })
  const lines = Object.entries(decision).map(([key, value]) => `${key}=${value}`)
  // A few capabilities fit one runner; all of acceptance needs them all.
  const acceptanceShards = decision.acceptance_capabilities ? 1 : acceptanceShardCount
  lines.push(`acceptance_shards=${JSON.stringify(Array.from({ length: acceptanceShards }, (_, i) => i + 1))}`)
  console.log(`${files.length} changed path(s)\n${lines.join('\n')}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('  \n')}\n`)
}
