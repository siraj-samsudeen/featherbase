import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { AppError } from './errors'
import { getDoc } from './document'

// RPT-005: script reports — server-side TypeScript functions that return
// columns + rows, plus a declared filter UI. Report modules live in
// src/reports/*.ts (each default-exporting a ScriptReport) and are registered
// at boot, like controllers. A Report document with report_type='Script Report'
// names the registered report in its `report_script` field.

export interface ReportFilterDef {
  fieldname: string
  label: string
  fieldtype: string // Data | Select | Check | Date | Int
  options?: string // newline-separated for Select
  default?: unknown
}

export interface ScriptReportResult {
  columns: string[]
  rows: Record<string, unknown>[]
}

export interface ScriptReport {
  name: string
  filters?: ReportFilterDef[]
  execute: (filters: Record<string, unknown>, user: string) => Promise<ScriptReportResult>
}

const registry = new Map<string, ScriptReport>()

export function registerScriptReport(report: ScriptReport) {
  registry.set(report.name, report)
}

export function getScriptReport(name: string): ScriptReport | undefined {
  return registry.get(name)
}

let loaded = false
export async function loadScriptReports() {
  if (loaded) return
  loaded = true
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'reports')
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => /\.(ts|js|mjs)$/.test(f))
  } catch {
    return
  }
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href)
    const report = mod.default as ScriptReport | undefined
    if (report?.name && typeof report.execute === 'function') registerScriptReport(report)
  }
}

// Resolve the ScriptReport a Report document points at (via report_script),
// enforcing the caller's read permission on the Report.
async function resolve(reportName: string, user: string): Promise<ScriptReport> {
  const report = await getDoc('Report', reportName, user)
  if (report.report_type !== 'Script Report')
    throw new AppError('ValidationError', `${reportName} is not a Script Report`)
  const key = typeof report.report_script === 'string' ? report.report_script : ''
  const script = key ? getScriptReport(key) : undefined
  if (!script) throw new AppError('ValidationError', `No script report registered as "${key}"`)
  return script
}

export async function scriptReportMeta(reportName: string, user: string) {
  const script = await resolve(reportName, user)
  return { name: reportName, script: script.name, filters: script.filters ?? [] }
}

export async function runScriptReport(
  reportName: string,
  filters: Record<string, unknown>,
  user: string,
): Promise<ScriptReportResult> {
  const script = await resolve(reportName, user)
  return script.execute(filters ?? {}, user)
}
