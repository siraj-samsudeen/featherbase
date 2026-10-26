/* The DEPLOY.md variable table and apps/server/.env.example, generated from
 * the registry in src/env.ts (instance-settings-as-code D6, #465).
 *
 *   pnpm --filter server generate:env        # rewrite both
 *   pnpm --filter server check:env           # fail when either is stale
 *
 * DEPLOY.md keeps its hand-written prose; only the block between the two
 * markers below is generated.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SETTINGS_CONDITIONS, VARIABLES, type Variable } from '../src/env'

export const DEPLOY_MD = fileURLToPath(new URL('../../../docs/DEPLOY.md', import.meta.url))
export const ENV_EXAMPLE = fileURLToPath(new URL('../.env.example', import.meta.url))
export const START = '<!-- generated:variables:start — from apps/server/src/env.ts by `pnpm --filter server generate:env`; do not edit -->'
export const END = '<!-- generated:variables:end -->'

const variables = VARIABLES as readonly Variable[]

export function requiredText(v: Variable): string {
  if (v.docsRequired) return v.docsRequired
  const r = v.required
  if (typeof r === 'object') return `**yes**, while ${SETTINGS_CONDITIONS[r.when]}`
  return {
    'outside-dev': '**yes**, outside development and test',
    recommended: 'recommended (warns when missing outside development and test)',
    optional: 'no',
    'forbidden-in-production': '**never in production**: development, test and staging only',
  }[r]
}

export function deployTable(vars: readonly Variable[] = variables): string {
  const rows = vars.map((v) =>
    `| \`${v.name}\` | ${requiredText(v)} | ${v.secret ? 'yes' : 'no'} | ${v.default ?? ''} | ${v.purpose}${v.crossEnvironment ? ` (${v.crossEnvironment === 'must-differ' ? 'must differ' : 'must match'} across environments)` : ''} |`)
  return [START, '', '| Variable | Required | Secret | Default | Purpose |', '| --- | --- | --- | --- | --- |', ...rows, '', END].join('\n')
}

/** Markdown to plain text for a comment line. */
const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|`/g, '')

export function envExample(vars: readonly Variable[] = variables): string {
  const lines = [
    '# Every variable the Featherbase server reads. Generated from',
    '# apps/server/src/env.ts by `pnpm --filter server generate:env`; do not edit.',
    '# Copy to apps/server/.env for a checkout (loaded at boot, never overriding the',
    '# shell), or set them in the host\'s variables. Every line is commented out: an',
    '# empty value counts as missing. Never commit a secret.',
  ]
  for (const v of vars) {
    lines.push('', `# ${plain(v.purpose)}`)
    lines.push(`# required: ${plain(requiredText(v))}${v.secret ? ' · SECRET' : ''}${v.default ? ` · default: ${plain(v.default)}` : ''}`)
    lines.push(`# ${v.name}=`)
  }
  return `${lines.join('\n')}\n`
}

export function withTable(deployMd: string, table: string = deployTable()): string {
  const start = deployMd.indexOf(START)
  const end = deployMd.indexOf(END)
  if (start === -1 || end === -1 || end < start) throw new Error(`docs/DEPLOY.md has no generated variable block (${START} … ${END})`)
  return deployMd.slice(0, start) + table + deployMd.slice(end + END.length)
}

/** The files that are out of date, by path. Empty means current. */
export function staleFiles(): string[] {
  const stale: string[] = []
  const md = readFileSync(DEPLOY_MD, 'utf8')
  if (withTable(md) !== md) stale.push('docs/DEPLOY.md')
  let example = ''
  try { example = readFileSync(ENV_EXAMPLE, 'utf8') } catch { /* missing is stale */ }
  if (example !== envExample()) stale.push('apps/server/.env.example')
  return stale
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.argv.includes('--check')) {
    const stale = staleFiles()
    if (stale.length) {
      console.error(`generate-env-docs: out of date with src/env.ts: ${stale.join(', ')}.\nRun: pnpm --filter server generate:env`)
      process.exit(1)
    }
    console.log('generate-env-docs: DEPLOY.md variable table and .env.example match src/env.ts')
  } else {
    writeFileSync(DEPLOY_MD, withTable(readFileSync(DEPLOY_MD, 'utf8')))
    writeFileSync(ENV_EXAMPLE, envExample())
    console.log('generate-env-docs: wrote docs/DEPLOY.md variable table and apps/server/.env.example')
  }
}
