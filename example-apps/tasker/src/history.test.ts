import { describe, expect, it } from 'vitest'
import { describeHistoryValue } from './history'

const people = [{ row_id: 'psn_a', full_name: 'Shahul' }, { row_id: 'psn_b', full_name: null }]
const projects = [{ row_id: 'TPROJ-0001', project_name: 'Data quality' }]
const names = { people, projects }

describe('activity history values', () => {
  it('names the person a task was assigned to instead of their record id', () => {
    expect(describeHistoryValue('assigned_to', 'psn_a', names)).toBe('Shahul')
    expect(describeHistoryValue('personal_tasks_owner', 'psn_a', names)).toBe('Shahul')
  })

  it('names who verifies, submitted and verified a task', () => {
    for (const field of ['verifier', 'submitted_by', 'verified_by'])
      expect(describeHistoryValue(field, 'psn_a', names)).toBe('Shahul')
  })

  it('names the project a task moved into', () => {
    expect(describeHistoryValue('project', 'TPROJ-0001', names)).toBe('Data quality')
  })

  it('says a person or project is no longer known rather than showing a record id', () => {
    expect(describeHistoryValue('assigned_to', 'psn_gone', names)).toBe('Former member')
    expect(describeHistoryValue('assigned_to', 'psn_b', names)).toBe('Former member')
    expect(describeHistoryValue('project', 'TPROJ-0099', names)).toBe('Project not available')
  })

  it('keeps empty values and ordinary fields readable', () => {
    expect(describeHistoryValue('assigned_to', null, names)).toBe('empty')
    expect(describeHistoryValue('project', '', names)).toBe('empty')
    expect(describeHistoryValue('task_state', 'Blocked', names)).toBe('Blocked')
    expect(describeHistoryValue('urgent', true, names)).toBe('true')
  })
})
