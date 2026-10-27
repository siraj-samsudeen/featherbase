import type { TableController } from '../controllers'
import { AppError } from '../errors'
import {
  EDITED_BY,
  IDENTIFIER_KINDS,
  MATCH,
  NORMALISE_RULES,
  SENSITIVITIES,
  SENSITIVITY,
  completeSystemRow,
  type IdentifierKind,
  type Sensitivity,
} from '../identifiers'

// person-resolution D2: an Identifier System row is configuration. The kind
// fills in every setting left unsaid (Tableau-style: detected, labelled,
// revertible); Sensitivity decides storage, display and tier together; and a
// few combinations are refused because they would defeat the system.
const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true'
const KEY = /^[a-z][a-z0-9-]{1,62}$/

const FLAGS = ['one_holder_at_a_time', 'one_per_person', 'assigner_scoped', 'enabled'] as const

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T))
    throw new AppError('ValidationError', `${field} must be one of: ${allowed.join(', ')}`, { [field]: allowed.join(', ') })
  return value as T
}

const controller: TableController = {
  table: 'Identifier System',
  hooks: {
    before_validate: async ({ row, old, isNew, tx }) => {
      const key = String(row.row_id ?? old?.row_id ?? '')
      if (isNew && !KEY.test(key))
        throw new AppError('ValidationError', 'An identifier system key is a lowercase slug like "stylehr-employee-code"', { row_id: 'lowercase slug' })
      const kind = oneOf(row.kind ?? old?.kind, IDENTIFIER_KINDS, 'kind') as IdentifierKind
      if (!isNew && old && row.kind !== undefined && row.kind !== old.kind) {
        const [used] = await tx`select 1 from person_identifier where system = ${key} limit 1`
        if (used) throw new AppError('ValidationError', 'The kind cannot change once values are recorded', { kind: 'fixed while values exist' })
      }
      // Fill what was left unsaid from the kind (insert) — an update keeps
      // what is stored unless it is changed.
      if (isNew) Object.assign(row, completeSystemRow({ ...row, kind }))
      const merged = { ...(old ?? {}), ...row }
      oneOf(merged.match, MATCH, 'match')
      oneOf(merged.normalise, NORMALISE_RULES, 'normalise')
      oneOf(merged.edited_by, EDITED_BY, 'edited_by')
      const sensitivity = oneOf(merged.sensitivity, SENSITIVITIES, 'sensitivity') as Sensitivity
      for (const f of FLAGS) if (row[f] !== undefined) row[f] = truthy(row[f])

      // A matching system must accept a second holder, or the duplicate it
      // is meant to point out could never be recorded (D2).
      if (merged.match !== 'Off' && truthy(merged.one_holder_at_a_time))
        throw new AppError(
          'ValidationError',
          'An identifier that points out duplicates must accept a second holder, so the duplicate can be pointed out; turn "One holder at a time" off or set Match to Off',
          { one_holder_at_a_time: 'off while Match is on' },
        )
      // Secret: never stored, shown by its last four digits, restricted —
      // the three are one setting (D2/D8).
      if (sensitivity === 'Secret' && kind !== 'national-id')
        throw new AppError('ValidationError', 'Only a national ID can be Secret', { sensitivity: 'Secret is for national IDs' })
      const derived = SENSITIVITY[sensitivity]
      row.storage = derived.storage
      row.display = derived.display
      row.tier = derived.tier
      if (sensitivity !== 'Secret' && merged.retain_after_leaving_days != null && merged.retain_after_leaving_days !== '')
        row.retain_after_leaving_days = null

      // Turning a uniqueness flag on is refused while the data breaks it.
      if (!isNew && old) {
        if (truthy(row.one_holder_at_a_time) && !truthy(old.one_holder_at_a_time)) {
          const [dup] = await tx`
            select 1 from person_identifier a join person_identifier b
              on a.system = b.system and a.assigner = b.assigner and a.value = b.value and a.id < b.id and a.valid && b.valid
            where a.system = ${key} limit 1`
          if (dup) throw new AppError('ConflictError', 'Some values are held by two people at once; resolve those first', { one_holder_at_a_time: 'duplicates exist' })
        }
        if (truthy(row.one_per_person) && !truthy(old.one_per_person)) {
          const [dup] = await tx`
            select 1 from person_identifier where system = ${key} and upper_inf(valid)
            group by person_id having count(*) > 1 limit 1`
          if (dup) throw new AppError('ConflictError', 'Some people hold two current values; end one first', { one_per_person: 'duplicates exist' })
        }
      }
    },
    // Flag changes re-stamp the rows' denormalised copies (D3).
    after_save: async ({ row, old, isNew, tx }) => {
      if (isNew || !old) return
      const key = String(row.row_id)
      const holder = truthy(row.one_holder_at_a_time)
      const perPerson = truthy(row.one_per_person)
      if (holder !== truthy(old.one_holder_at_a_time) || perPerson !== truthy(old.one_per_person))
        await tx`update person_identifier set one_holder = ${holder}, one_per_person = ${perPerson} where system = ${key}`
    },
    on_trash: async ({ row, tx }) => {
      const [{ n }] = await tx`select count(*)::int as n from person_identifier where system = ${String(row.row_id)}`
      if (n > 0) throw new AppError('ConflictError', `${n} recorded value(s) use this identifier system; it cannot be deleted. Turn it off instead.`)
    },
  },
}

export default controller
