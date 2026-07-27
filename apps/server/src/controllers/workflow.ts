import type { TableController } from '../controllers'
import { ensureStateField, validateWorkflow } from '../workflow'
import type { WorkflowState, WorkflowTransition } from '../workflow'

// WF-001: validate a workflow definition (no transitions to/from undefined
// states) and, once active, ensure the target Table has a workflow_state
// column so every row carries its state.
const controller: TableController = {
  table: 'Workflow',
  hooks: {
    validate: ({ row }) => {
      const states = (row.states as WorkflowState[] | undefined) ?? []
      const transitions = (row.transitions as WorkflowTransition[] | undefined) ?? []
      validateWorkflow(states, transitions)
    },
    after_save: async ({ row, tx }) => {
      if (row.is_active && typeof row.ref_table === 'string') {
        // Binding an existing column (state_field) is validated here — saving
        // a workflow that names a nonexistent column fails; a blank
        // state_field auto-adds the default workflow_state column.
        const field = String(row.state_field ?? '').trim() || 'workflow_state'
        await ensureStateField(row.ref_table, tx, field)
      }
    },
  },
}

export default controller
