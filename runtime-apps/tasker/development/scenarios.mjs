export const TASKER_SCENARIOS = {
  users: [
    { row_id: 'asha.local@example.test', email: 'asha.local@example.test', full_name: 'Asha Local', enabled: true },
    { row_id: 'dev.local@example.test', email: 'dev.local@example.test', full_name: 'Dev Local', enabled: true },
  ],
  projects: [
    { row_id: 'DEV-TASKER-PROJECT-STOCK-REVIEW', project_name: 'September stock review' },
    { row_id: 'DEV-TASKER-PROJECT-STORE-OPENING', project_name: 'Store opening readiness' },
  ],
  tasks: [
    { row_id: 'DEV-TASKER-TASK-INVOICE-MISMATCH', task_title: 'Triage supplier invoice mismatch', urgent: true },
    { row_id: 'DEV-TASKER-TASK-MONDAY-IDEAS', task_title: 'Collect ideas for the Monday review', urgent: false },
    { row_id: 'DEV-TASKER-TASK-WAREHOUSE-DATE', task_title: 'Confirm warehouse count date', task_state: 'Blocked', explanation: 'Blocked until the warehouse confirms the night-shift roster.' },
    { row_id: 'DEV-TASKER-TASK-STOCK-VARIANCE', task_title: 'Reconcile the first stock variance', project: 'DEV-TASKER-PROJECT-STOCK-REVIEW', assigned_to: 'asha.local@example.test', task_state: 'In progress', urgent: true },
    { row_id: 'DEV-TASKER-TASK-RECEIVING-BAY', task_title: 'Photograph the receiving bay', project: 'DEV-TASKER-PROJECT-STOCK-REVIEW' },
    { row_id: 'DEV-TASKER-TASK-FIRE-SAFETY', task_title: 'Confirm fire-safety inspection', project: 'DEV-TASKER-PROJECT-STORE-OPENING', task_state: 'On hold', explanation: 'On hold while the landlord supplies the renewed certificate.' },
    { row_id: 'DEV-TASKER-TASK-DISCUSSION-NOTES', task_title: 'Draft my discussion notes', personal_tasks_owner: 'Administrator' },
    { row_id: 'DEV-TASKER-TASK-ARCHIVE-CHECKLIST', task_title: 'Archive last month’s launch checklist', project: 'DEV-TASKER-PROJECT-STORE-OPENING', task_state: 'Done', is_done: true },
  ],
  focus: ['DEV-TASKER-TASK-STOCK-VARIANCE', 'DEV-TASKER-TASK-INVOICE-MISMATCH', 'DEV-TASKER-TASK-DISCUSSION-NOTES'],
}
