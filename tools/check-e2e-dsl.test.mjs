/**
 * Tests for check-e2e-dsl.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Create a temporary directory for test files
function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dsl-check-'))
}

function createSpecFile(dir, name, content) {
  const specPath = path.join(dir, `${name}.spec.ts`)
  fs.writeFileSync(specPath, content)
  return specPath
}

function runCheck(dir) {
  try {
    // Change to the temp directory as the working directory
    const cwd = process.cwd()
    const result = execSync(`node ${path.join(cwd, 'tools/check-e2e-dsl.mjs')}`, {
      cwd: dir,
      encoding: 'utf8'
    })
    return { ok: true, output: result }
  } catch (err) {
    return { ok: false, output: err.stdout || err.message, stderr: err.stderr || '' }
  }
}

test('check-e2e-dsl: passing file with test from ./fixtures', async () => {
  const tempDir = createTempDir()
  try {
    // Create the e2e directory structure
    const e2eDir = path.join(tempDir, 'apps/web/e2e')
    fs.mkdirSync(e2eDir, { recursive: true })

    // Create a valid spec file
    createSpecFile(
      e2eDir,
      'valid',
      `import { test, expect } from './fixtures'

test('works', async ({ session }) => {
  await session.visit('/')
})
`
    )

    const result = runCheck(tempDir)
    assert.ok(result.ok, `Check should pass; got: ${result.stderr || result.output}`)
    assert.match(result.output, /E2E DSL check OK: 1 file/, 'Should report 1 file OK')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('check-e2e-dsl: fail on test from @playwright/test', async () => {
  const tempDir = createTempDir()
  try {
    const e2eDir = path.join(tempDir, 'apps/web/e2e')
    fs.mkdirSync(e2eDir, { recursive: true })

    createSpecFile(
      e2eDir,
      'bad-pw-import',
      `import { test, expect } from '@playwright/test'

test('works', ({ page }) => {})
`
    )

    const result = runCheck(tempDir)
    assert.ok(!result.ok, 'Check should fail')
    assert.match(result.output, /imports test from @playwright\/test/, 'Should mention the bad import')
    assert.match(result.output, /must use \.\/fixtures/, 'Should suggest ./fixtures')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('check-e2e-dsl: fail on test from feather-testing-core/playwright', async () => {
  const tempDir = createTempDir()
  try {
    const e2eDir = path.join(tempDir, 'apps/web/e2e')
    fs.mkdirSync(e2eDir, { recursive: true })

    createSpecFile(
      e2eDir,
      'bad-core-import',
      `import { test } from 'feather-testing-core/playwright'

test('works', ({ page }) => {})
`
    )

    const result = runCheck(tempDir)
    assert.ok(!result.ok, 'Check should fail')
    assert.match(
      result.output,
      /imports test from feather-testing-core\/playwright/,
      'Should mention the bad import'
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('check-e2e-dsl: fail on missing test import from ./fixtures', async () => {
  const tempDir = createTempDir()
  try {
    const e2eDir = path.join(tempDir, 'apps/web/e2e')
    fs.mkdirSync(e2eDir, { recursive: true })

    createSpecFile(
      e2eDir,
      'no-fixtures-import',
      `import { expect } from '@playwright/test'

test('works', ({ page }) => {})
`
    )

    const result = runCheck(tempDir)
    assert.ok(!result.ok, 'Check should fail')
    assert.match(
      result.output,
      /does not import test or anonymousTest from \.\/fixtures/,
      'Should mention missing fixtures import'
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('check-e2e-dsl: allow import of expect and types from @playwright/test', async () => {
  const tempDir = createTempDir()
  try {
    const e2eDir = path.join(tempDir, 'apps/web/e2e')
    fs.mkdirSync(e2eDir, { recursive: true })

    createSpecFile(
      e2eDir,
      'types-from-pw',
      `import { test } from './fixtures'
import { expect, type Page } from '@playwright/test'

test('works', async ({ session }) => {
  await session.visit('/')
})
`
    )

    const result = runCheck(tempDir)
    assert.ok(result.ok, `Check should pass; got: ${result.stderr || result.output}`)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('check-e2e-dsl: allow import of createSession from feather-testing-core/playwright', async () => {
  const tempDir = createTempDir()
  try {
    const e2eDir = path.join(tempDir, 'apps/web/e2e')
    fs.mkdirSync(e2eDir, { recursive: true })

    createSpecFile(
      e2eDir,
      'core-helper',
      `import { test } from './fixtures'
import { createSession } from 'feather-testing-core/playwright'

test('works', async ({ session }) => {
  await session.visit('/')
})
`
    )

    const result = runCheck(tempDir)
    assert.ok(result.ok, `Check should pass; got: ${result.stderr || result.output}`)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('check-e2e-dsl: skip file with exemption comment', async () => {
  const tempDir = createTempDir()
  try {
    const e2eDir = path.join(tempDir, 'apps/web/e2e')
    fs.mkdirSync(e2eDir, { recursive: true })

    createSpecFile(
      e2eDir,
      'exempt-file',
      `// e2e-dsl: exempt — legacy test using raw Playwright

import { test } from '@playwright/test'

test('works', ({ page }) => {})
`
    )

    const result = runCheck(tempDir)
    assert.ok(result.ok, `Check should pass (file is exempt); got: ${result.stderr || result.output}`)
    assert.match(result.output, /1 exempt/, 'Should report file as exempt')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('check-e2e-dsl: allow anonymousTest import', async () => {
  const tempDir = createTempDir()
  try {
    const e2eDir = path.join(tempDir, 'apps/web/e2e')
    fs.mkdirSync(e2eDir, { recursive: true })

    createSpecFile(
      e2eDir,
      'anon-test',
      `import { anonymousTest as test } from './fixtures'

test('login works', async ({ session }) => {
  await session.visit('/login')
})
`
    )

    const result = runCheck(tempDir)
    assert.ok(result.ok, `Check should pass; got: ${result.stderr || result.output}`)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
