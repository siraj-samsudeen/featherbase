// Dates are relative to the day the sample is loaded, so it always shows late and upcoming work.
function day(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const TASKER_SCENARIOS = {
  stores: [
    { row_id: 'DEV-TASKER-STORE-AVADI', store_name: 'Avadi Store', store_type: 'Store' },
    { row_id: 'DEV-TASKER-STORE-KEELKATTALAI', store_name: 'Keelkattalai Store', store_type: 'Store' },
    { row_id: 'DEV-TASKER-STORE-MADHAVARAM', store_name: 'Madhavaram Store', store_type: 'Store' },
    { row_id: 'DEV-TASKER-STORE-PALLAIKARANAI', store_name: 'Pallaikaranai Store', store_type: 'Store' },
    { row_id: 'DEV-TASKER-STORE-TAMBARAM', store_name: 'Tambaram Store', store_type: 'Store' },
    { row_id: 'DEV-TASKER-STORE-KANIYAPURAM', store_name: 'Kaniyapuram Store', store_type: 'Store' },
    { row_id: 'DEV-TASKER-STORE-MANIMANGALAM', store_name: 'Manimangalam WH', store_type: 'Warehouse' },
    { row_id: 'DEV-TASKER-STORE-KATTARAPAKKAM', store_name: 'Kattarapakkam WH', store_type: 'Warehouse' },
    { row_id: 'DEV-TASKER-STORE-CORPORATE', store_name: 'Jeyarama Corporate Office', store_type: 'Store' },
  ],
  users: [
    // person-rename: a person's id is minted; the seed finds people by email
    // and tasks name them by email, mapped to the minted id when seeded.
    { email: 'asha.local@example.test', full_name: 'Asha Local', enabled: true },
    { email: 'dev.local@example.test', full_name: 'Dev Local', enabled: true },
  ],
  projects: [
    { row_id: 'DEV-TASKER-PROJECT-STOCK-REVIEW', project_name: 'September stock review' },
    { row_id: 'DEV-TASKER-PROJECT-STORE-OPENING', project_name: 'Store opening readiness' },
    { row_id: 'DEV-TASKER-PROJECT-DIWALI', project_name: 'Diwali store readiness' },
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
    { row_id: 'DEV-TASKER-TASK-STOCK-VARIANCE', task_title: 'Reconcile the first stock variance', project: 'DEV-TASKER-PROJECT-STOCK-REVIEW', store: 'DEV-TASKER-STORE-KEELKATTALAI', start_date: day(-6), due_date: day(-2), assigned_to: 'asha.local@example.test', task_state: 'In progress', urgent: true, description: 'Start with the highest-value variance, trace receipt and transfer documents, then record the likely cause.', comments: ['Asha is checking the transfer posted after the physical count.', 'The first receipt now ties; one transfer remains open.'] },
    { row_id: 'DEV-TASKER-TASK-RECEIVING-BAY', task_title: 'Photograph the receiving bay', project: 'DEV-TASKER-PROJECT-STOCK-REVIEW', store: 'DEV-TASKER-STORE-MANIMANGALAM', due_date: day(0) },
    { row_id: 'DEV-TASKER-TASK-FIRE-SAFETY', task_title: 'Confirm fire-safety inspection', project: 'DEV-TASKER-PROJECT-STORE-OPENING', store: 'DEV-TASKER-STORE-PALLAIKARANAI', due_date: day(-1), task_state: 'On hold', explanation: 'On hold while the landlord supplies the renewed certificate.' },
    { row_id: 'DEV-TASKER-TASK-DISCUSSION-NOTES', task_title: 'Draft my discussion notes', personal_tasks_owner: 'Administrator' },
    { row_id: 'DEV-TASKER-TASK-ARCHIVE-CHECKLIST', task_title: 'Archive last month’s launch checklist', project: 'DEV-TASKER-PROJECT-STORE-OPENING', store: 'DEV-TASKER-STORE-PALLAIKARANAI', task_state: 'Done', is_done: true },
    { row_id: 'DEV-TASKER-TASK-DIWALI-DISPLAY', task_title: 'Diwali display change-over', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-AVADI', start_date: day(4), due_date: day(6) },
    { row_id: 'DEV-TASKER-TASK-AVADI-SWEETS', task_title: 'Set up the sweets gift-box counter', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-AVADI', start_date: day(-3), due_date: day(3), task_state: 'In progress' },
    { row_id: 'DEV-TASKER-TASK-AVADI-PRINTER', task_title: 'Fix the billing printer at till 3', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-AVADI', due_date: day(-1), urgent: true },
    { row_id: 'DEV-TASKER-TASK-KEEL-COLDROOM', task_title: 'Check the cold-room temperature log', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-KEELKATTALAI', due_date: day(0) },
    { row_id: 'DEV-TASKER-TASK-KEEL-STAFF', task_title: 'Roster extra billing staff for Diwali week', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-KEELKATTALAI', start_date: day(2), due_date: day(5) },
    { row_id: 'DEV-TASKER-TASK-KEEL-SIGNAGE', task_title: 'Replace the faded entrance signage', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-KEELKATTALAI', task_state: 'Done', is_done: true },
    { row_id: 'DEV-TASKER-TASK-MADH-LIGHTS', task_title: 'Install festival lighting', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-MADHAVARAM', due_date: day(2), task_state: 'In progress', assigned_to: 'Administrator', verifier: 'asha.local@example.test',
      after: [{ task_state: 'Submitted for verification', evidence_note: 'Strung lights on the front fascia and both entrances; every circuit tested on the generator.' }] },
    { row_id: 'DEV-TASKER-TASK-TAMB-AUDIT', task_title: 'Pre-Diwali shelf audit', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-TAMBARAM', due_date: day(-3),
      after: [{ due_date: day(1), change_reason: 'Festival stock reached Tambaram two days late' }] },
    { row_id: 'DEV-TASKER-TASK-KATT-HAMPERS', task_title: 'Count the festival gift hampers', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-KATTARAPAKKAM', due_date: day(1), assigned_to: 'dev.local@example.test', verifier: 'Administrator' },
    { row_id: 'DEV-TASKER-TASK-AVADI-SUPPLIER', task_title: 'Book a second sweets supplier', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-AVADI', task_state: 'Cancelled', change_reason: 'The main supplier confirmed the full Diwali quantity' },
    { row_id: 'DEV-TASKER-TASK-MANI-DISPATCH', task_title: 'Plan festival stock dispatch to stores', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-MANIMANGALAM', start_date: day(-1), due_date: day(1), task_state: 'In progress', assigned_to: 'dev.local@example.test' },
    { row_id: 'DEV-TASKER-TASK-KATT-FORKLIFT', task_title: 'Service the forklift', project: 'DEV-TASKER-PROJECT-DIWALI', store: 'DEV-TASKER-STORE-KATTARAPAKKAM', start_date: day(7), due_date: day(8) },
  ],
  focus: ['DEV-TASKER-TASK-STOCK-VARIANCE', 'DEV-TASKER-TASK-INVOICE-MISMATCH', 'DEV-TASKER-TASK-DISCUSSION-NOTES'],
  projectStars: ['DEV-TASKER-PROJECT-STOCK-REVIEW', 'DEV-TASKER-PROJECT-STORE-OPENING'],
  detailMode: 'inspector',
}
