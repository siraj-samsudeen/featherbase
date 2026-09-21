export const TASKER_SCENARIOS = {
  users: [
    { row_id: 'asha.local@example.test', email: 'asha.local@example.test', full_name: 'Asha Local', enabled: true },
    { row_id: 'dev.local@example.test', email: 'dev.local@example.test', full_name: 'Dev Local', enabled: true },
  ],
  projects: [
    { row_id: 'DEV-TASKER-PROJECT-STOCK-REVIEW', project_name: 'September stock review' },
    { row_id: 'DEV-TASKER-PROJECT-STORE-OPENING', project_name: 'Store opening readiness' },
    { row_id: 'DEV-TASKER-PROJECT-TEST-DRIVE', project_name: 'Tasker Test Drive', description: `## Report feedback

- One observation per task.
- Title: \`Surface — observed gap\`.
- Type: Bug | Expectation mismatch | Small improvement.

### Description template

- **I was trying to:**
- **What happened:**
- **What I expected:**
- **Done when:**
- **Evidence:**

### Triage agreement

- **Not started:** captured.
- **In progress:** accepted.
- **Blocked:** needs reporter.
- **Done:** fixed and retested.
- **Cancelled:** declined with an explanation.

Urgent is only for blocked testing, data loss or security.

Unassigned means ready for triage. Assigned means the named person must answer or verify.` },
  ],
  tasks: [
    { row_id: 'DEV-TASKER-TASK-INVOICE-MISMATCH', task_title: 'Triage supplier invoice mismatch', urgent: true, description: 'Compare the supplier invoice against the received quantities and note the first mismatched line.', comments: ['Purchasing has shared the signed invoice copy.'] },
    { row_id: 'DEV-TASKER-TASK-MONDAY-IDEAS', task_title: 'Collect ideas for the Monday review', urgent: false },
    { row_id: 'DEV-TASKER-TASK-WAREHOUSE-DATE', task_title: 'Confirm warehouse count date', task_state: 'Blocked', explanation: 'Blocked until the warehouse confirms the night-shift roster.' },
    { row_id: 'DEV-TASKER-TASK-STOCK-VARIANCE', task_title: 'Reconcile the first stock variance', project: 'DEV-TASKER-PROJECT-STOCK-REVIEW', assigned_to: 'asha.local@example.test', task_state: 'In progress', urgent: true, description: 'Start with the highest-value variance, trace receipt and transfer documents, then record the likely cause.', comments: ['Asha is checking the transfer posted after the physical count.', 'The first receipt now ties; one transfer remains open.'] },
    { row_id: 'DEV-TASKER-TASK-RECEIVING-BAY', task_title: 'Photograph the receiving bay', project: 'DEV-TASKER-PROJECT-STOCK-REVIEW' },
    { row_id: 'DEV-TASKER-TASK-FIRE-SAFETY', task_title: 'Confirm fire-safety inspection', project: 'DEV-TASKER-PROJECT-STORE-OPENING', task_state: 'On hold', explanation: 'On hold while the landlord supplies the renewed certificate.' },
    { row_id: 'DEV-TASKER-TASK-DISCUSSION-NOTES', task_title: 'Draft my discussion notes', personal_tasks_owner: 'Administrator' },
    { row_id: 'DEV-TASKER-TASK-ARCHIVE-CHECKLIST', task_title: 'Archive last month’s launch checklist', project: 'DEV-TASKER-PROJECT-STORE-OPENING', task_state: 'Done', is_done: true },
  ],
  focus: ['DEV-TASKER-TASK-STOCK-VARIANCE', 'DEV-TASKER-TASK-INVOICE-MISMATCH', 'DEV-TASKER-TASK-DISCUSSION-NOTES'],
  projectStars: ['DEV-TASKER-PROJECT-STOCK-REVIEW', 'DEV-TASKER-PROJECT-STORE-OPENING'],
  detailMode: 'inspector',
}
