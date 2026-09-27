import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { checkCatalog, parseCapabilityPage, writeCatalog } from './capability-catalog.mjs'

function temporaryRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'featherbase-capabilities-'))
  fs.mkdirSync(path.join(root, 'docs/capabilities/application-ui'), { recursive: true })
  fs.mkdirSync(path.join(root, 'openspec/specs/example-pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'openspec/specs/example-pages/spec.md'), '# Example pages\n')
  return root
}

function writePage(root, relativePath, frontmatter, body = '## Purpose\n\nFixture purpose.\n') {
  const filePath = path.join(root, 'docs/capabilities', relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(
    filePath,
    `---\n${frontmatter.trim()}\n---\n\n# Fixture\n\n${body}`,
  )
}

test('parseCapabilityPage reads scalar and list metadata', () => {
  const entry = parseCapabilityPage(`---
id: workspace-page
kind: capability
title: Workspace
status: partial
parent: application-ui
summary: A role-aware landing page.
issues:
  - 277
related:
  - metric-block
---

# Workspace
`, 'workspace.md')

  assert.equal(entry.id, 'workspace-page')
  assert.equal(entry.status, 'partial')
  assert.deepEqual(entry.issues, [277])
  assert.deepEqual(entry.related, ['metric-block'])
})

test('writeCatalog generates the root index and page connections from metadata', () => {
  const root = temporaryRepository()
  try {
    writePage(root, 'application-ui/README.md', `
id: application-ui
kind: capability-group
title: Application UI
status: partial
summary: Reusable application pages.
alternatives:
  - component-tree-json
`)
    writePage(root, 'application-ui/workspace.md', `
id: workspace-page
kind: capability
title: Workspace
status: partial
parent: application-ui
summary: A role-aware landing page.
specifications:
  - example-pages
issues:
  - 277
related:
  - application-ui
proving_applications:
  - training
`)
    writePage(root, 'proving-applications/training.md', `
id: training
kind: proving-application
title: Training
stage: planned
summary: Rebuild the training course as a portable Featherbase application.
capabilities:
  - workspace-page
`)
    writePage(root, 'design-options/component-tree-json.md', `
id: component-tree-json
kind: design-option
title: Arbitrary component-tree JSON
disposition: deferred
parent: application-ui
summary: Describe every component in JSON.
related:
  - workspace-page
`)

    writeCatalog(root)

    const index = fs.readFileSync(path.join(root, 'docs/APPLICATION_MODEL.md'), 'utf8')
    assert.match(index, /\[Workspace\]\(\.\/capabilities\/application-ui\/workspace\.md\)/)
    assert.match(index, /◐ Partial/)
    assert.match(index, /\[example-pages\]\(\.\.\/openspec\/specs\/example-pages\/spec\.md\)/)
    assert.match(index, /issues\/277/)
    assert.match(index, /Design options/)
    assert.match(index, /Proving applications/)
    assert.match(index, /\[Training\]\(\.\/capabilities\/proving-applications\/training\.md\)/)
    assert.doesNotMatch(index, /\.spec\.(ts|tsx)|\.test\.(ts|tsx)/)

    const parent = fs.readFileSync(
      path.join(root, 'docs/capabilities/application-ui/README.md'),
      'utf8',
    )
    assert.match(parent, /<!-- capability-catalog:start -->/)
    assert.match(parent, /Sub-capabilities/)
    assert.match(parent, /workspace\.md/)
    assert.match(parent, /Arbitrary component-tree JSON/)

    const workspace = fs.readFileSync(
      path.join(root, 'docs/capabilities/application-ui/workspace.md'),
      'utf8',
    )
    assert.match(workspace, /\[Training\]\(\.\.\/proving-applications\/training\.md\)/)

    assert.doesNotThrow(() => checkCatalog(root))
    fs.appendFileSync(path.join(root, 'docs/APPLICATION_MODEL.md'), '\nDrift\n')
    assert.throws(() => checkCatalog(root), /run `pnpm generate:capabilities`/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('writeCatalog rejects a one-sided proving-application relationship', () => {
  const root = temporaryRepository()
  try {
    writePage(root, 'application-ui/README.md', `
id: application-ui
kind: capability-group
title: Application UI
status: partial
summary: Reusable application pages.
`)
    writePage(root, 'application-ui/workspace.md', `
id: workspace-page
kind: capability
title: Workspace
status: partial
parent: application-ui
summary: A role-aware landing page.
proving_applications:
  - training
`)
    writePage(root, 'proving-applications/training.md', `
id: training
kind: proving-application
title: Training
stage: planned
summary: Rebuild the training course.
capabilities:
  - application-ui
`)

    assert.throws(() => writeCatalog(root), /must list workspace-page/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('writeCatalog rejects unknown relationships and missing specifications', () => {
  const root = temporaryRepository()
  try {
    writePage(root, 'application-ui/README.md', `
id: application-ui
kind: capability-group
title: Application UI
status: partial
summary: Reusable application pages.
`)
    writePage(root, 'application-ui/workspace.md', `
id: workspace-page
kind: capability
title: Workspace
status: partial
parent: application-ui
summary: A role-aware landing page.
specifications:
  - missing-specification
related:
  - missing-capability
`)

    assert.throws(() => writeCatalog(root), error => {
      assert.match(error.message, /unknown related capability missing-capability/)
      assert.match(error.message, /missing specification missing-specification/)
      return true
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
