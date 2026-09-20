import type { AppManifest } from '../apps'
import type { HookContext } from '../controllers'
import { AppError } from '../errors'

function prepareTask(ctx: HookContext): void {
  if (ctx.row.project && ctx.row.personal_tasks_owner)
    throw new AppError(
      'ValidationError',
      'Choose either a project or Personal tasks, not both',
      { personal_tasks_owner: 'Remove the project before choosing Personal tasks' },
    )
  if (ctx.row.personal_tasks_owner)
    ctx.row.assigned_to = ctx.row.personal_tasks_owner
  else if (
    ctx.old?.personal_tasks_owner &&
    ctx.row.assigned_to === ctx.old.personal_tasks_owner
  )
    ctx.row.assigned_to = null

  const oldDone = Boolean(ctx.old?.is_done)
  const nextDone = Boolean(ctx.row.is_done)
  const oldState = String(ctx.old?.task_state ?? 'Not started')
  const nextState = String(ctx.row.task_state ?? 'Not started')
  const doneChanged = nextDone !== oldDone
  const stateChanged = nextState !== oldState

  if (doneChanged && nextDone) {
    ctx.row.state_before_done = nextState === 'Done' ? oldState : nextState
    ctx.row.task_state = 'Done'
  } else if (doneChanged) {
    ctx.row.task_state = stateChanged
      ? nextState
      : String(ctx.old?.state_before_done ?? 'Not started')
    ctx.row.state_before_done = null
  } else if (stateChanged && nextState === 'Done') {
    ctx.row.is_done = true
    ctx.row.state_before_done = oldState
  } else if (stateChanged) {
    ctx.row.is_done = false
    ctx.row.state_before_done = null
  }
}

const taskManagement: AppManifest = {
  name: 'task-management',
  tables: [
    {
      name: 'Team Project',
      module: 'Tasks',
      id_pattern: 'TPROJ-.####',
      title_column: 'project_name',
      columns: [
        {
          column_name: 'project_name',
          label: 'Project name',
          column_type: 'Data',
          reqd: true,
          in_list_view: true,
        },
      ],
    },
    {
      name: 'Team Task',
      module: 'Tasks',
      id_pattern: 'TASK-.#####',
      title_column: 'task_title',
      columns: [
        {
          column_name: 'task_title',
          label: 'Task',
          column_type: 'Data',
          reqd: true,
          in_list_view: true,
        },
        { column_name: 'description', label: 'Description', column_type: 'Text' },
        {
          column_name: 'task_state',
          label: 'State',
          column_type: 'Choice',
          choices: 'Not started\nIn progress\nBlocked\nOn hold\nDone\nCancelled',
          default_value: 'Not started',
          in_list_view: true,
        },
        {
          column_name: 'is_done',
          label: 'Done',
          column_type: 'Check',
          default_value: '0',
          in_list_view: true,
        },
        {
          column_name: 'urgent',
          label: 'Urgent',
          column_type: 'Check',
          default_value: '0',
          in_list_view: true,
        },
        {
          column_name: 'project',
          label: 'Project',
          column_type: 'Reference',
          reference_table: 'Team Project',
          in_list_view: true,
        },
        {
          column_name: 'personal_tasks_owner',
          label: 'Personal tasks owner',
          column_type: 'Reference',
          reference_table: 'User',
        },
        {
          column_name: 'assigned_to',
          label: 'Assigned to',
          column_type: 'Reference',
          reference_table: 'User',
          in_list_view: true,
        },
        {
          column_name: 'state_before_done',
          label: 'State before done',
          column_type: 'Data',
          hidden: true,
        },
      ],
    },
  ],
  permissions: [
    {
      table: 'Team Project',
      role: 'All',
      can_read: true,
      can_write: true,
      can_create: true,
      can_delete: true,
    },
    {
      table: 'Team Task',
      role: 'All',
      can_read: true,
      can_write: true,
      can_create: true,
      can_delete: true,
    },
    {
      table: 'User',
      role: 'All',
      can_read: true,
    },
    {
      table: 'Comment',
      role: 'All',
      can_read: true,
      can_write: true,
      can_create: true,
    },
  ],
  doc_events: {
    'Team Task': { before_validate: prepareTask },
  },
  fixtures: [
    {
      table: 'Home Page',
      rows: [
        {
          row_id: 'task-management',
          label: 'Tasks',
          module: 'Tasks',
          shortcuts: JSON.stringify([
            { label: 'Open task workspace', type: 'url', link_to: '/admin/tasks' },
          ]),
        },
      ],
    },
  ],
}

export default taskManagement
