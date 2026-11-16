// instance-health's fenced scenarios that the server alone proves. Each test is
// one fenced scenario of openspec/specs/instance-health/spec.md, step by step.
import { expect } from 'vitest'
import { sql } from '../../src/db'
import { runHealthChecks, type HealthCheck } from '../../src/instance-health'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'

const scenario = scenarioFor(test, 'instance-health')
const check = (checks: HealthCheck[]) => checks.find((c) => c.key === 'scope-provider-tables:healthscope')

// rama_dw #4588: a scope provider refuses everyone when a Table or column it reads is missing,
// so the instance names what it lacks before anyone finds out by losing access.
scenario('An instance lacks a Table the scope provider reads', async ({}, step) => {
  await step('the user has an instance whose scope provider reads a Table the instance does not have', async () => {
    const manifest = { name: 'healthscope', title: 'Health scope', scopeProvider: { name: 'org', tables: ['Health Site', 'Health Assignment'] },
      baseTables: { read: { 'Health Assignment': ['employee', 'region'], 'Health Other': ['ignored'] } } }
    await sql`insert into installed_app (name, manifest, enabled, runtime_package) values ('healthscope', ${sql.json(manifest)}, true, true)`
    await sql`insert into table_def (name) values ('Health Assignment')`
    await sql`insert into column_def (parent, column_name, column_type) values ('Health Assignment', 'employee', 'Data')`
  })
  let checks: HealthCheck[] = []
  await step('the user checks its health', async () => { checks = await runHealthChecks() })
  await step(/the missing Table is named as an operational fault/, () => {
    expect(check(checks)).toMatchObject({ ok: false, severity: 'error', state: 'fault', title: 'Every Table Health scope reads for people\'s scope exists',
      message: 'Health scope reads for people\'s scope what this instance lacks: Table Health Site, column Health Assignment.region. Until they exist, no one gets a scope from it.' })
  })
  await step(/once the Table and its declared columns exist, the check passes/, async () => {
    await sql`insert into table_def (name) values ('Health Site')`
    await sql`insert into column_def (parent, column_name, column_type) values ('Health Assignment', 'region', 'Data')`
    expect(check(await runHealthChecks())).toMatchObject({ ok: true, fix: null,
      message: 'Every Table and column Health scope reads for people\'s scope exists.' })
  })
})
