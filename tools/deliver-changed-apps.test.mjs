import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changedApps } from './deliver-changed-apps.mjs'

const isApp = (folder) => ['client-apps/acme/board', 'example-apps/tasker'].includes(folder)

test('an app whose code changed is delivered; one whose manifest changed waits for the deploy', () => {
  assert.deepEqual(changedApps([
    'client-apps/acme/board/src/page.tsx',
    'example-apps/tasker/src/a.ts', 'example-apps/tasker/featherbase.json',
  ], isApp), [
    { folder: 'client-apps/acme/board', manifestChanged: false },
    { folder: 'example-apps/tasker', manifestChanged: true },
  ])
})

test('instance folders, the platform and anything that is not an app are left out', () => {
  assert.deepEqual(changedApps(['client-apps/acme/instances/board/instance.json', 'apps/server/src/x.ts', 'example-apps/notes.md', 'client-apps/acme/CLAUDE.md'], isApp), [])
})
