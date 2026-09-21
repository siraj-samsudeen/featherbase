import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

// @spec task_activity_stays_in_tasker
// @spec project_markdown_is_shared
// @spec my_work_has_no_duplicates
export async function proveTaskerAcceptance({ page, api, expect, output, origin }) {
  const evidence = []
  async function capture(name, expected) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal page overflow`)
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true })
    evidence.push({ screenshot: `${name}.png`, expected, observed: 'Executed assertions passed; screenshot requires human inspection' })
  }
  const title = 'When I Take a task. It is assigned to me, but it does not appear in my personal task.'
  const task = await api('/api/save_row', { table: 'tasker.task', row: { task_title: title } }, 201)
  const populated = await api('/api/save_row', { table: 'tasker.task', row: {
    task_title: 'Description rendering probe', description: '## Check the evidence\n\n- First observation\n- Second observation\n\n[Reference](https://example.test) and `inline code`.\n\n```text\nA long code line remains scrollable instead of pushing the viewport wider.\n```',
    task_state: 'Blocked', urgent: true,
  } }, 201)
  await page.reload()
  for (const width of [1440, 375]) {
    const size = width === 375 ? 'mobile' : 'desktop'
    await page.setViewportSize({ width, height: 900 })
    for (const [nav, slug] of [[/^Inbox/, 'inbox'], [/^My Work/, 'my-work'], ['Together', 'together'], [/^Personal tasks/, 'personal'], ['Projects', 'projects']]) {
      await page.getByRole('button', { name: nav, exact: typeof nav === 'string' }).click()
      await capture(`${size}-${slug}`, `Readable ${slug} navigation surface, closed detail, no horizontal overflow`)
    }
    await page.getByRole('button', { name: 'Open project Tasker Test Drive' }).click()
    await expect(page.getByRole('region', { name: 'Project description' })).toContainText('One observation per task')
    await capture(`${size}-project-description`, 'Shared Markdown beneath project title, lists and feedback agreement readable; task entry remains available')
    await page.getByRole('button', { name: 'Edit description', exact: true }).click()
    await capture(`${size}-project-editor`, 'Explicit Project Markdown editor with Save and Cancel, no clipping')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: /^Inbox/ }).click()
    for (const [source, content] of [[task, 'empty'], [populated, 'populated']]) {
      await page.getByRole('link', { name: source.task_title, exact: true }).click()
      for (const mode of ['Inspector', 'Focus', 'Compact']) {
        await page.getByRole('button', { name: mode, exact: true }).click()
        await expect(page.getByRole('button', { name: mode, exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect.poll(async () => (await api('/api/user_settings/tasker.preferences')).settings.mode).toBe(mode.toLowerCase())
        const region = page.getByRole('region', { name: 'Task detail content' })
        await expect(region.getByRole('combobox', { name: 'Task state' })).toHaveValue(source.task_state)
        await expect(region.getByRole('textbox', { name: 'Description', exact: true })).toHaveCount(0)
        await capture(`${size}-${mode.toLowerCase()}-${content}`, `${mode} ${content} read state: workflow visible, no unrequested textarea or Save; context preserved on close`)
      }
      await page.getByRole('link', { name: 'Close', exact: true }).click()
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('link', { name: title, exact: true }).click()
  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  const detail = page.getByRole('region', { name: 'Task detail content' })
  await detail.getByRole('button', { name: 'Take it', exact: true }).click()
  await expect(detail.getByRole('combobox', { name: 'Task responsibility' })).toHaveValue('Administrator')
  const taken = await api(`/api/table/tasker.task/${task.row_id}`)
  assert.equal(taken.assigned_to, 'Administrator')
  assert.equal(taken.task_state, 'Not started')
  assert.equal(taken.personal_tasks_owner, null)
  await capture('desktop-taken-focus', 'Take persisted as Administrator without starting work or changing Inbox destination')
  await detail.getByRole('link', { name: 'Close' }).click()
  await page.getByRole('button', { name: /^My Work/ }).click()
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(1)
  await capture('desktop-taken-my-work', 'Taken task appears exactly once in My Work after persisted assignment read-back')
  await page.getByRole('button', { name: /^Personal tasks/ }).click()
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await page.getByRole('link', { name: title, exact: true }).click()
  await page.getByRole('button', { name: 'Inspector', exact: true }).click()
  await detail.getByRole('button', { name: 'Edit task' }).click()
  await detail.getByRole('textbox', { name: 'Task title' }).fill('My stale draft')
  await api('/api/save_row', { table: 'tasker.task', row: { row_id: task.row_id, updated_at: taken.updated_at, description: 'Another editor wrote this' } }, 201)
  await detail.getByRole('button', { name: 'Save task' }).click()
  await expect(detail.getByRole('alert')).toContainText(/modified|changed|conflict/i)
  await expect(detail.getByRole('textbox', { name: 'Task title' })).toHaveValue('My stale draft')
  await capture('desktop-stale-draft', 'Stale Save explains conflict, preserves user draft and never overwrites competing description')
  await page.setViewportSize({ width: 375, height: 900 })
  await capture('mobile-stale-draft', 'Conflict and Save/Cancel remain visible within the full-screen mobile Inspector')
  await detail.getByRole('button', { name: 'Cancel changes' }).click()
  await detail.getByRole('link', { name: 'Close' }).click()
  await page.reload()
  await page.getByRole('link', { name: title, exact: true }).click()
  await detail.getByRole('button', { name: 'Edit task' }).click()
  await detail.getByRole('textbox', { name: 'Task title' }).fill('Corrected Take observation')
  await capture('mobile-task-editor', 'Intentional task editor, title correction and description with keyboard-accessible Save/Cancel')
  await detail.getByRole('button', { name: 'Save task' }).click()
  await expect(detail.getByRole('heading', { name: 'Corrected Take observation' })).toBeVisible()
  for (const state of ['In progress', 'Blocked', 'On hold', 'Done', 'Cancelled', 'Not started']) {
    await detail.getByRole('combobox', { name: 'Task state' }).selectOption(state)
    await expect(detail.getByRole('combobox', { name: 'Task state' })).toHaveValue(state)
    const row = await api(`/api/table/tasker.task/${task.row_id}`)
    assert.equal(row.task_state, state)
    assert.equal(row.is_done, state === 'Done')
    assert.equal(row.assigned_to, 'Administrator')
    if (['Blocked', 'Done'].includes(state)) await capture(`mobile-state-${state.toLowerCase()}`, `${state} is persisted and completion agrees, responsibility retained`)
  }
  await detail.getByRole('link', { name: 'Close' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${origin}/tasker/#task=missing-task-proof`)
  await expect(page.getByRole('region', { name: 'Task detail content' }).getByRole('alert')).toContainText(/not found/i)
  await capture('desktop-missing-task', 'Deleted or missing selected task has an explanation and Close rather than stale editable data')
  await page.getByRole('link', { name: 'Close' }).click()
  // A response can be lost after the host commits. Retry must use the durable
  // envelope even after reload and even though the simple source is now gone.
  const simple = await api('/api/save_row', { table: 'tasker.task', row: { task_title: 'Promote simple proof', description: 'Copied project context' } }, 201)
  await page.goto(`${origin}/tasker/#task=${simple.row_id}`)
  await page.getByLabel('More task actions').click()
  await capture('desktop-task-actions', 'Discoverable overflow offers Promote to project and Delete accidental task')
  await page.route('**/api/app_actions/tasker/promote', async route => {
    const response = await route.fetch()
    assert.equal(response.status(), 200)
    await route.abort('failed')
    await page.unroute('**/api/app_actions/tasker/promote')
  }, { times: 1 })
  await page.getByRole('button', { name: 'Promote to project', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry same request' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Retry same request' }).click()
  await expect(page.getByRole('heading', { name: 'Promote simple proof', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Project description' })).toContainText('Copied project context')
  const simpleProjects = await api(`/api/table/tasker.project?filters=${encodeURIComponent(JSON.stringify([['project_name', '=', 'Promote simple proof']]))}`)
  assert.equal(simpleProjects.data.length, 1)
  await capture('desktop-simple-promoted', 'Lost-response retry after reload returns the same single project, copies description and removes simple source')

  const rich = await api('/api/save_row', { table: 'tasker.task', row: { task_title: 'Promote rich proof', assigned_to: 'Administrator', urgent: true, task_state: 'In progress' } }, 201)
  await api('/api/save_row', { table: 'Comment', row: { ref_table: 'tasker.task', ref_name: rich.row_id, content: 'Keep this discussion attached' } }, 201)
  await page.goto(`${origin}/tasker/#task=${rich.row_id}`)
  await page.getByLabel('More task actions').click()
  await page.getByRole('button', { name: 'Promote to project', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('keep this task as its first task')
  await capture('desktop-promote-confirm', 'Rich preservation prompt explains assignment, urgency, comments and activity; Cancel initially focused')
  await page.setViewportSize({ width: 375, height: 900 })
  await capture('mobile-promote-confirm', 'Rich confirmation fits mobile with safe Cancel and Continue')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await api(`/api/table/tasker.task/${rich.row_id}`)).project, null)
  await page.getByLabel('More task actions').click()
  await page.getByRole('button', { name: 'Promote to project', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Promote rich proof', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Promote rich proof', exact: true })).toBeVisible()
  const retained = await api(`/api/table/tasker.task/${rich.row_id}`)
  assert(retained.project)
  assert.equal(retained.assigned_to, 'Administrator')
  assert.equal(retained.urgent, true)
  assert.equal((await api(`/api/activity/tasker.task/${rich.row_id}`)).comments[0].content, 'Keep this discussion attached')
  await page.getByRole('link', { name: 'Promote rich proof', exact: true }).click()
  await page.getByLabel('More task actions').click()
  await page.getByRole('button', { name: 'Delete accidental task', exact: true }).click()
  await capture('mobile-delete-confirm', 'Delete confirmation distinguishes permanent accidental removal from Cancelled retained work')
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(page.getByRole('alert')).toContainText('Choose Cancelled')
  await capture('mobile-delete-refused', 'Retained work cannot be deleted; explanation directs user to Cancelled')
  await page.getByRole('link', { name: 'Close', exact: true }).click()
  const accident = await api('/api/save_row', { table: 'tasker.task', row: { task_title: 'Delete accidental proof' } }, 201)
  await page.goto(`${origin}/tasker/`)
  await page.getByRole('button', { name: 'Add to My Focus: Delete accidental proof' }).click()
  await page.getByRole('button', { name: /^My Work/ }).click()
  await page.getByRole('link', { name: 'Delete accidental proof' }).click()
  await page.getByLabel('More task actions').click()
  await page.getByRole('button', { name: 'Delete accidental task', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await api(`/api/table/tasker.task/${accident.row_id}`)).task_title, 'Delete accidental proof')
  await page.getByLabel('More task actions').click()
  await page.getByRole('button', { name: 'Delete accidental task', exact: true }).click()
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(page.getByRole('region', { name: 'Task detail content' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Delete accidental proof' })).toHaveCount(0)
  await capture('mobile-deleted-my-work', 'Confirmed accidental deletion closes detail and stale focus disappears immediately')
  // Return the original literal package proof to its known Inbox state.
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`${origin}/tasker/`)
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await writeFile(resolve(output, 'tasker-acceptance.json'), JSON.stringify({
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    equivalenceClasses: evidence, takeReadBack: taken,
    limitations: ['Local packaged proof only; exact deployed-commit owner/member smoke is parent-coordinated.'],
  }, null, 2))
}
