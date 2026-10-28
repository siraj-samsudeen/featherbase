// Comparing environments (#465, design D10; spec instance-health "Compare
// environments without revealing secrets"). Each environment answers a
// variable report for a key the caller picks for the run: which declared
// variables are set, a truncated HMAC-SHA256 of each secret with a
// cross-environment rule, and where its settings stand against the file.
// compareEnvironments puts the reports side by side. A new key each run means
// fingerprints cannot be collected and matched across runs, and are useless
// to anyone without that run's key; nothing here is kept, and no value is
// ever returned. Whoever holds the key (a System Manager) could test guesses
// against a fingerprint, so the rule-bearing secrets must be long and random,
// as DEPLOY.md says.
import { createHash, createHmac } from 'node:crypto'
import { z } from 'zod'
import { AppError } from './errors'
import { currentEnvironment, DEV_ENVIRONMENTS, isSet, readNamedVariable, readVariable, VARIABLES, type Variable, type VariableName } from './env'

/** Long enough that nobody without the run's key can guess it. */
export const MIN_KEY_LENGTH = 32
const MAX_KEY_LENGTH = 512

/** Whether a variable's presence matters in this environment: required stops
 *  a release, recommended warns, optional is never checked. */
export type Presence = 'required' | 'recommended' | 'optional'

export interface VariableEntry {
  name: string
  secret: boolean
  presence: Presence
  set: boolean
  rule?: 'must-differ' | 'must-match'
  /** Only for a set variable with a rule. */
  fingerprint?: string
}

export interface VariableReport {
  /** What this process runs as (FEATHERBASE_ENV, then NODE_ENV). */
  environment: string
  /** Names the key without revealing it, so reports from different runs are
   *  never compared. */
  key_id: string
  variables: VariableEntry[]
  settings: {
    applied: boolean
    /** The file's environment section the last apply used. */
    environment: string | null
    revision: string | null
    /** Null before the first apply, or when the last apply kept no values. */
    matches_file: boolean | null
  }
}

/** The first 16 hex digits of HMAC-SHA256(key, value). */
export function fingerprint(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex').slice(0, 16)
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH)
    throw new AppError(
      'ValidationError',
      `The key must be a random string of at least ${MIN_KEY_LENGTH} characters (and at most ${MAX_KEY_LENGTH}), new for each comparison, e.g. \`openssl rand -hex 32\`.`,
      { key: `at least ${MIN_KEY_LENGTH} characters` },
    )
}

/** This environment's variable report for one run's key. Never throws on
 *  what the environment holds, only on a bad key. */
export async function variableReport(key: unknown): Promise<VariableReport> {
  assertKey(key)
  // Imported here: release-preflight pulls in the release's whole dependency graph.
  const { settingsRequirements } = await import('./release-preflight')
  const { conditions, named } = await settingsRequirements()
  // As the release judges this environment (env.ts checkVariables):
  // development and test need nothing that has a working default, and only
  // warn about a feature's secret.
  const dev = DEV_ENVIRONMENTS.includes(currentEnvironment())
  const presenceOf = (v: Variable): Presence => {
    const req = v.required
    if (typeof req === 'object') return !conditions?.has(req.when) ? 'optional' : dev ? 'recommended' : 'required'
    if (dev) return 'optional'
    if (req === 'outside-dev') return 'required'
    if (req === 'recommended') return 'recommended'
    return 'optional'
  }
  const variables: VariableEntry[] = (VARIABLES as readonly Variable[]).map((v) => {
    const set = isSet(v.name as VariableName)
    const entry: VariableEntry = { name: v.name, secret: v.secret, presence: presenceOf(v), set }
    if (v.crossEnvironment) {
      entry.rule = v.crossEnvironment
      if (set) entry.fingerprint = fingerprint(key, readVariable(v.name as VariableName)!)
    }
    return entry
  })
  // A data source's connection string: the instance names the variable, and
  // the release warns while it is missing (release-preflight.ts).
  // It warns in every environment, so it is at least recommended, even when
  // the source names a declared variable.
  for (const { name } of named ?? []) {
    const declared = variables.find((v) => v.name === name)
    if (declared) {
      if (declared.presence === 'optional') declared.presence = 'recommended'
    } else variables.push({ name, secret: true, presence: 'recommended', set: Boolean(readNamedVariable(name)?.trim()) })
  }
  return {
    environment: currentEnvironment(),
    key_id: createHash('sha256').update(key).digest('hex').slice(0, 8),
    variables,
    settings: await settingsState(),
  }
}

async function settingsState(): Promise<VariableReport['settings']> {
  const { settingsAgainstFile } = await import('./instance-settings')
  const { apply, drift } = await settingsAgainstFile()
  if (!apply) return { applied: false, environment: null, revision: null, matches_file: null }
  return { applied: true, environment: apply.environment, revision: apply.revision, matches_file: drift === null ? null : drift.length === 0 }
}

// ---------------------------------------------------------------- comparison

export type Verdict = 'ok' | 'note' | 'problem'

export interface ComparisonRow {
  kind: 'variable' | 'settings'
  name: string
  /** One cell per environment label, in the order given. */
  values: Record<string, string>
  verdict: Verdict
  reason: string
}

export interface Comparison {
  labels: string[]
  rows: ComparisonRow[]
  problems: number
  notes: number
}

const and = (labels: string[]) =>
  labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`

function compareVariable(name: string, entries: (VariableEntry | undefined)[], labels: string[]): ComparisonRow | null {
  const setOn = labels.filter((_, i) => entries[i]?.set)
  if (!setOn.length) return null
  const values = Object.fromEntries(labels.map((l, i) => [l, entries[i]?.set ? 'set' : 'unset']))
  const row = (verdict: Verdict, reason = ''): ComparisonRow => ({ kind: 'variable', name, values, verdict, reason })
  const rule = entries.find((e) => e?.rule)?.rule
  const fingerprints = entries.map((e) => e?.fingerprint)

  if (rule === 'must-differ') {
    // Every group of environments that share one value.
    const shared = new Map<string, string[]>()
    labels.forEach((l, i) => {
      if (fingerprints[i]) shared.set(fingerprints[i]!, [...(shared.get(fingerprints[i]!) ?? []), l])
    })
    const same = [...shared.values()].filter((group) => group.length > 1)
    if (same.length) return row('problem', `the same on ${same.map(and).join('; ')}; it must differ between environments`)
  }
  if (rule === 'must-match' && new Set(fingerprints.filter(Boolean)).size > 1)
    return row('problem', `differs between ${and(setOn)}; it must be the same in every environment`)
  if (setOn.length < labels.length) {
    // Missing is a problem only where that environment itself needs it: a
    // feature's secret is not needed where the feature is off.
    const needed = labels.filter((_, i) => !entries[i]?.set && entries[i]?.presence !== undefined && entries[i]?.presence !== 'optional')
    const reason = needed.length ? `set on ${and(setOn)} only; ${and(needed)} ${needed.length === 1 ? 'needs' : 'need'} it` : `set on ${and(setOn)} only`
    return row(needed.length ? 'problem' : 'note', reason)
  }
  return row('ok')
}

function compareSettings(reports: VariableReport[], labels: string[]): ComparisonRow[] {
  const revisionCell = (r: VariableReport) => {
    if (!r.settings.applied) return 'never applied'
    const revision = r.settings.revision ? r.settings.revision.slice(0, 12) : 'no revision'
    return r.settings.environment ? `${revision} (${r.settings.environment})` : revision
  }
  const revisions: ComparisonRow = {
    kind: 'settings', name: 'Settings file revision',
    values: Object.fromEntries(labels.map((l, i) => [l, revisionCell(reports[i])])), verdict: 'ok', reason: '',
  }
  const never = labels.filter((_, i) => !reports[i].settings.applied)
  if (never.length) Object.assign(revisions, { verdict: 'problem', reason: `never applied on ${and(never)}` })
  else if (new Set(reports.map((r) => r.settings.revision)).size > 1)
    Object.assign(revisions, { verdict: 'problem', reason: `${and(labels)} were applied from different revisions` })
  else {
    // Each environment applies its own section of the file; two on one section
    // means one of them has the other's values.
    const bySection = new Map<string, string[]>()
    labels.forEach((l, i) => {
      const section = reports[i].settings.environment
      if (section) bySection.set(section, [...(bySection.get(section) ?? []), l])
    })
    const shared = [...bySection.entries()].filter(([, group]) => group.length > 1)
    // Labels are the caller's names, so a section is judged against a label
    // only when the two vocabularies meet: dev applied with the prod section.
    const sections = new Set(bySection.keys())
    const crossed = labels.filter((l, i) => {
      const section = reports[i].settings.environment
      return section && section !== l && (sections.has(l) || labels.includes(section))
    })
    const unrevised = labels.filter((_, i) => !reports[i].settings.revision)
    if (crossed.length)
      Object.assign(revisions, { verdict: 'problem', reason: crossed.map((l) => `${l} was applied with the ${reports[labels.indexOf(l)].settings.environment} section`).join('; ') })
    else if (shared.length)
      Object.assign(revisions, { verdict: 'problem', reason: shared.map(([section, group]) => `${and(group)} were both applied with the ${section} section`).join('; ') })
    else if (unrevised.length)
      Object.assign(revisions, { verdict: 'note', reason: `no revision recorded on ${and(unrevised)}, so the files cannot be told apart` })
  }

  const matchCell = (r: VariableReport) =>
    !r.settings.applied ? 'not applied' : r.settings.matches_file === null ? 'unknown' : r.settings.matches_file ? 'yes' : 'no'
  const matches: ComparisonRow = {
    kind: 'settings', name: 'Settings match the file',
    values: Object.fromEntries(labels.map((l, i) => [l, matchCell(reports[i])])), verdict: 'ok', reason: '',
  }
  const changed = labels.filter((_, i) => reports[i].settings.matches_file === false)
  const unknown = labels.filter((_, i) => reports[i].settings.applied && reports[i].settings.matches_file === null)
  if (changed.length) Object.assign(matches, { verdict: 'problem', reason: `changed outside the file on ${and(changed)}` })
  else if (unknown.length) Object.assign(matches, { verdict: 'note', reason: `cannot tell on ${and(unknown)} until the file is applied again` })
  return [revisions, matches]
}

const reportSchema = z.object({
  environment: z.string(),
  key_id: z.string().regex(/^[0-9a-f]{8}$/),
  variables: z.array(z.object({
    name: z.string(),
    secret: z.boolean(),
    presence: z.enum(['required', 'recommended', 'optional']),
    set: z.boolean(),
    rule: z.enum(['must-differ', 'must-match']).optional(),
    fingerprint: z.string().optional(),
  })),
  settings: z.object({
    applied: z.boolean(),
    environment: z.string().nullable(),
    revision: z.string().nullable(),
    matches_file: z.boolean().nullable(),
  }),
})

/** Read a report someone saved, without echoing its text: a wrong file (an
 *  error page, a .env) must not reach a CI log. */
export function parseVariableReport(text: string): VariableReport {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('it is not JSON')
  }
  const parsed = reportSchema.safeParse(json)
  if (!parsed.success) throw new Error(`it is not a variable report (${parsed.error.issues.map((i) => i.path.join('.') || 'the file').slice(0, 3).join(', ')})`)
  return parsed.data
}

/** Put two or more environments' reports side by side. Every report must
 *  come from the same run's key. */
export function compareEnvironments(environments: { label: string; report: VariableReport }[]): Comparison {
  if (environments.length < 2) throw new Error('compare at least two environments')
  const labels = environments.map((e) => e.label)
  const twice = labels.find((l, i) => labels.indexOf(l) !== i)
  if (twice) throw new Error(`the environment ${twice} is named twice`)
  const reports = environments.map((e) => e.report)
  if (new Set(reports.map((r) => r.key_id)).size > 1)
    throw new Error('the reports were made with different keys; fingerprints compare only within one run, so ask every environment with the same key')

  const names: string[] = []
  for (const r of reports) for (const v of r.variables) if (!names.includes(v.name)) names.push(v.name)
  const rows: ComparisonRow[] = []
  for (const name of names) {
    const row = compareVariable(name, reports.map((r) => r.variables.find((v) => v.name === name)), labels)
    if (row) rows.push(row)
  }
  rows.push(...compareSettings(reports, labels))
  return {
    labels,
    rows,
    problems: rows.filter((r) => r.verdict === 'problem').length,
    notes: rows.filter((r) => r.verdict === 'note').length,
  }
}

/** The side-by-side table, as plain text, ending with the count. */
export function formatComparison(comparison: Comparison): string {
  const result = (r: ComparisonRow) => (r.verdict === 'ok' ? 'ok' : `${r.verdict === 'problem' ? 'PROBLEM' : 'note'}: ${r.reason}`)
  const table = [
    ['Variable', ...comparison.labels, 'Result'],
    ...comparison.rows.map((r) => [r.name, ...comparison.labels.map((l) => r.values[l]), result(r)]),
  ]
  const widths = table[0].map((_, c) => Math.max(...table.map((line) => line[c].length)))
  const lines = table.map((line) => line.map((cell, c) => (c === line.length - 1 ? cell : cell.padEnd(widths[c]))).join('  '))
  const { problems, notes } = comparison
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  lines.push(`${problems ? plural(problems, 'problem') : 'No problems'}${notes ? `, ${plural(notes, 'note')}` : ''}.`)
  return lines.join('\n')
}
