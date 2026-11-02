import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { resolve } from 'node:path'
import { discoverPackages } from 'server/src/runtime-packages'
import { installApp } from 'server/src/apps'
import { taskerClient } from '../../server/test/tasker-client'
import { Attention } from '../../../example-apps/tasker/src/Attention'
import { TaskManagementPage } from '../../../example-apps/tasker/src/TaskManagement'
import { Discussion } from '../../../example-apps/tasker/src/Discussion'
import { setSession } from '../src/lib/api'
import { test, expect } from './pg-test'

test('a reply needs review, reading does not resolve it, and reopening asks for a new reply', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const asker = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Asha' }))
  const respondent = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Ravi' }))
  const task = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Review delivery' } })
  const question = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Question', body: 'When will it arrive?', reply_needed_from: respondent.user } })
  await respondent.post('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Reply', parent_message: question.row_id, body: 'Friday morning' } })
  setSession(asker.token!, { row_id: asker.user!, email: null, full_name: 'Asha' })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Attention tasks={[{ row_id: task.row_id, task_title: 'Review delivery' }]} onOpen={() => {}} /><Discussion taskId={task.row_id} /></QueryClientProvider>)
  const user = userEvent.setup()
  expect(await screen.findByText('Needs asker’s review')).toBeInTheDocument()
  const attention = screen.getByRole('region', { name: 'Needs your attention' })
  expect(within(attention).getByRole('button', { name: 'When will it arrive?' })).toBeInTheDocument()
  expect(within(attention).getByText('Review answer')).toBeInTheDocument()
  expect(await screen.findByText('Ravi')).toBeInTheDocument()
  expect(screen.getByText('Friday morning')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Mark read' }))
  await waitFor(() => expect(screen.queryByText('Unread')).not.toBeInTheDocument())
  expect(screen.getByText('Needs asker’s review')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Mark answered' }))
  expect(await screen.findByText('Resolved')).toBeInTheDocument()
  expect(within(attention).queryByRole('button', { name: 'When will it arrive?' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Reopen question' }))
  expect(await screen.findByText('Waiting for reply')).toBeInTheDocument()
  expect(screen.getByText('Friday morning')).toBeInTheDocument()
})


test('Attention opens and focuses the exact question inside the task inspector', async ({ createUser }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  await installApp('tasker')
  const asker = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Asha' }))
  const respondent = taskerClient(await createUser({ roles: ['Tasker Member'], fullName: 'Ravi' }))
  const task = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.task', row: { task_title: 'Delivery questions' } })
  const question = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Question', body: 'Which entrance?', reply_needed_from: respondent.user } })
  const other = await asker.post<{ row_id: string }>('/api/save_row', { table: 'tasker.discussion', row: { task: task.row_id, kind: 'Question', body: 'Who will unload?', reply_needed_from: respondent.user } })
  setSession(respondent.token!, { row_id: respondent.user!, email: null, full_name: 'Ravi' })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskManagementPage /></QueryClientProvider>)
  try {
    await userEvent.click(await screen.findByRole('button', { name: 'Which entrance?' }))
    await screen.findByRole('complementary', { name: 'Task details' })
    await waitFor(() => expect(document.getElementById(`question-${question.row_id}`)).toHaveFocus())
    expect(new URLSearchParams(location.hash.slice(1)).get('question')).toBe(question.row_id)
    await userEvent.click(screen.getByRole('link', { name: 'Close' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Who will unload?' }))
    await waitFor(() => expect(document.getElementById(`question-${other.row_id}`)).toHaveFocus())
  } finally { location.hash = '' }
})
