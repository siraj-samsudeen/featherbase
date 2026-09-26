#!/usr/bin/env node
/**
 * CI check: every apps/web/e2e/*.spec.ts must use the DSL-backed test fixture.
 *
 * Rule: imports test or anonymousTest from ./fixtures (which are DSL-backed);
 * may import types and expect from @playwright/test; must not import test
 * directly from @playwright/test or feather-testing-core/playwright.
 *
 * Exemption: a file whose first line is `// e2e-dsl: exempt — <reason>` is skipped.
 */

import fs from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const e2eDir = path.join(projectRoot, 'apps/web/e2e')

// Find all .spec.ts files using fs.readdirSync
const specFiles = fs
  .readdirSync(e2eDir)
  .filter(f => f.endsWith('.spec.ts'))
  .sort()

const failures = []
const exempt = []

for (const fileName of specFiles) {
  const filePath = path.join(e2eDir, fileName)
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')

  // Check for exemption
  const firstLine = lines[0] || ''
  if (firstLine.match(/^\/\/\s*e2e-dsl:\s*exempt\s*—/)) {
    exempt.push(fileName)
    continue
  }

  // Check for bad imports
  const issues = []

  // Must not import test from @playwright/test
  if (content.match(/from\s+['"]@playwright\/test['"]/)) {
    if (content.match(/\btest\b.*from\s+['"]@playwright\/test['"]/)) {
      issues.push('imports test from @playwright/test (must use ./fixtures)')
    }
  }

  // Must not import test from feather-testing-core/playwright
  if (content.match(/from\s+['"]feather-testing-core\/playwright['"]/)) {
    if (content.match(/\btest\b.*from\s+['"]feather-testing-core\/playwright['"]/)) {
      issues.push('imports test from feather-testing-core/playwright (must use ./fixtures)')
    }
  }

  // Must import test or anonymousTest from ./fixtures
  // Handle both single-line and multi-line imports
  const hasTestFromFixtures = /from\s+['"]\.\/fixtures['"]/.test(content) &&
    (/\btest\b/.test(content) || /\banonymousTest\b/.test(content))
  if (!hasTestFromFixtures) {
    issues.push('does not import test or anonymousTest from ./fixtures')
  }

  if (issues.length > 0) {
    failures.push({ file: fileName, issues })
  }
}

// Report
if (failures.length > 0) {
  console.error(`E2E DSL check failed: ${failures.length} file(s) do not use the DSL\n`)
  for (const { file, issues } of failures) {
    console.error(`  ${file}`)
    for (const issue of issues) {
      console.error(`    - ${issue}`)
    }
  }
  console.error()
  process.exit(1)
}

const exemptStr = exempt.length > 0 ? ` (${exempt.length} exempt)` : ''
console.log(`E2E DSL check OK: ${specFiles.length} file(s)${exemptStr}`)
process.exit(0)
