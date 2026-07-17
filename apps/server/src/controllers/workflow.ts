import type { DocTypeController } from '../controllers'
import { ensureStateField, validateWorkflow } from '../workflow'
import type { WorkflowState, WorkflowTransition } from '../workflow'

// WF-001: validate a workflow definition (no transitions to/from undefined
// states) and, once active, ensure the target DocType has a workflow_state
// field so every document carries its state.
const controller: DocTypeController = {
  doctype: 'Workflow',
  hooks: {
    validate: ({ doc }) => {
      const states = (doc.states as WorkflowState[] | undefined) ?? []
      const transitions = (doc.transitions as WorkflowTransition[] | undefined) ?? []
      validateWorkflow(states, transitions)
    },
    after_save: async ({ doc, tx }) => {
      if (doc.is_active && typeof doc.document_type === 'string')
        await ensureStateField(doc.document_type, tx)
    },
  },
}

export default controller
