// The navigation rule (#1227, AGENTS.md § UI rules): every Featherbase record
// shown on any screen is a RecordLink (@featherbase/shop-floor); a plain-text
// record name is a bug. This guard reads source, like design-guards.test.ts.
// It counts, per file, the record links still built by hand (the row route, or
// rowHref): the counts below may only go down, and no other file may gain one.
// Converting a file to RecordLink lowers its count here in the same commit.
// A plain-text name cannot be found by reading source reliably; the UI verifier
// checks that one (AGENTS.md § UI rules).
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const ROOT = join(__dirname, '../../..')
const HAND_BUILT = /table\/\$table\/row\/\$name|rowHref\(/g

/** The hand-built record links on 16-Nov-2026, when RecordLink arrived. */
const ALLOWED: Record<string, number> = {
  'apps/web/src/components/CalendarView.tsx': 1,
  'apps/web/src/components/ChangeRecord.tsx': 1,
  'apps/web/src/components/CopySchedule.tsx': 1,
  'apps/web/src/components/DataSourcesSidebar.tsx': 1,
  'apps/web/src/components/FormView.tsx': 3,
  'apps/web/src/components/GanttView.tsx': 1,
  'apps/web/src/components/HomePageView.tsx': 1,
  'apps/web/src/components/ImportConflicts.tsx': 1,
  'apps/web/src/components/KanbanView.tsx': 1,
  'apps/web/src/components/LinkControl.tsx': 1,
  'apps/web/src/components/ListRows.tsx': 2,
  'apps/web/src/components/CommandPalette.tsx': 1,
  'apps/web/src/components/PurgeDialog.tsx': 1,
  'apps/web/src/components/RecentStrip.tsx': 1,
  'apps/web/src/components/RecordNav.tsx': 1,
  'apps/web/src/components/ReportView.tsx': 1,
  'apps/web/src/components/RowPane.tsx': 1,
  'apps/web/src/gallery/PrototypeApp.tsx': 2,
  'apps/web/src/lib/navigation.tsx': 1,
  'apps/web/src/lib/row-name.tsx': 1,
  'apps/web/src/pages/FindPerson.tsx': 1,
  'apps/web/src/pages/Glossary.tsx': 1,
  'apps/web/src/pages/SourceBrowser.tsx': 1,
  'apps/web/src/router.tsx': 2,
  'example-apps/tasker/src/TaskDetail.tsx': 1,
}

function screens(): string[] {
  const listed = execFileSync('git', ['ls-files', 'apps/web/src', 'client-apps', 'example-apps', 'packages/shop-floor/src'], { cwd: ROOT, encoding: 'utf8' })
  return listed.split('\n').filter((file) => file.endsWith('.tsx') && !/\.(test|stories)\.tsx$/.test(file) && !file.endsWith('/RecordLink.tsx'))
}

test('no screen builds a record link by hand beyond what was there when RecordLink arrived', () => {
  const grown: string[] = []
  for (const file of screens()) {
    const found = readFileSync(join(ROOT, file), 'utf8').match(HAND_BUILT)?.length ?? 0
    if (found > (ALLOWED[file] ?? 0)) grown.push(`${file}: ${found} hand-built record link(s), ${ALLOWED[file] ?? 0} allowed — use RecordLink`)
  }
  expect(grown).toEqual([])
})

test('a file converted to RecordLink has its allowance lowered, so the count only goes down', () => {
  const stale: string[] = []
  for (const [file, allowed] of Object.entries(ALLOWED)) {
    let found = 0
    try { found = readFileSync(join(ROOT, file), 'utf8').match(HAND_BUILT)?.length ?? 0 } catch { /* the file is gone */ }
    if (found < allowed) stale.push(`${file}: ${found} now, ${allowed} allowed — lower it to ${found}`)
  }
  expect(stale).toEqual([])
})
