// Identifier systems and their values (OpenSpec change `person-resolution`,
// D2/D3; Phase 1a-i — no fingerprinting yet).
//
// An Identifier System is one namespace of values (an HR employee code, a
// phone number, another system's record number). Its `kind` fills in every
// other default — how values are tidied, whether a value has one holder at a
// time, whether a person may hold only one, how it is shown and to whom —
// and each can be changed under Advanced. Sensitivity is the one visible
// setting that decides storage, display and tier together.
import { AppError } from './errors'

export const IDENTIFIER_KINDS = ['employee-record', 'external-record', 'national-id', 'contact'] as const
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number]

export const SENSITIVITIES = ['Normal', 'Restricted', 'Restricted, hidden', 'Secret'] as const
export type Sensitivity = (typeof SENSITIVITIES)[number]

export const NORMALISE_RULES = ['none', 'trim', 'upper', 'lower', 'digits', 'indian-mobile'] as const
export type NormaliseRule = (typeof NORMALISE_RULES)[number]

export const EDITED_BY = ['source', 'system-manager', 'reviewers', 'self'] as const
export type EditedBy = (typeof EDITED_BY)[number]

export const MATCH = ['Off', 'Suggest'] as const
type Match = (typeof MATCH)[number]

type Storage = 'plain' | 'fingerprint'
type Display = 'full' | 'hidden' | 'last4'
type Tier = 'basic' | 'restricted'

/** Sensitivity → how a value is stored, shown, and who may read it (D2). */
export const SENSITIVITY: Record<Sensitivity, { storage: Storage; display: Display; tier: Tier }> = {
  Normal: { storage: 'plain', display: 'full', tier: 'basic' },
  Restricted: { storage: 'plain', display: 'full', tier: 'restricted' },
  'Restricted, hidden': { storage: 'plain', display: 'hidden', tier: 'restricted' },
  Secret: { storage: 'fingerprint', display: 'last4', tier: 'restricted' },
}

interface SystemSettings {
  kind: IdentifierKind
  normalise: NormaliseRule
  one_holder_at_a_time: boolean
  one_per_person: boolean
  assigner_scoped: boolean
  match: Match
  sensitivity: Sensitivity
  edited_by: EditedBy
  retain_after_leaving_days: number | null
}

/** The defaults each kind fills in (D2's kind table). `contact` depends on
 *  whether it is a phone or an address, told apart by `variant`. */
export function kindPreset(kind: IdentifierKind, variant: 'phone' | 'email' | null = null): SystemSettings {
  switch (kind) {
    case 'employee-record':
      return { kind, normalise: 'upper', one_holder_at_a_time: true, one_per_person: false, assigner_scoped: true, match: 'Off', sensitivity: 'Normal', edited_by: 'source', retain_after_leaving_days: null }
    case 'external-record':
      return { kind, normalise: 'trim', one_holder_at_a_time: true, one_per_person: false, assigner_scoped: false, match: 'Off', sensitivity: 'Restricted, hidden', edited_by: 'source', retain_after_leaving_days: null }
    case 'national-id':
      return { kind, normalise: 'digits', one_holder_at_a_time: false, one_per_person: true, assigner_scoped: false, match: 'Suggest', sensitivity: 'Secret', edited_by: 'system-manager', retain_after_leaving_days: 365 }
    case 'contact':
      return variant === 'phone'
        ? { kind, normalise: 'indian-mobile', one_holder_at_a_time: false, one_per_person: false, assigner_scoped: false, match: 'Suggest', sensitivity: 'Restricted', edited_by: 'self', retain_after_leaving_days: null }
        : { kind, normalise: 'lower', one_holder_at_a_time: false, one_per_person: false, assigner_scoped: false, match: 'Suggest', sensitivity: 'Normal', edited_by: 'self', retain_after_leaving_days: null }
  }
}

/** Fill what a new Identifier System row leaves unsaid from its kind, and
 *  derive storage / display / tier from Sensitivity. One function for the
 *  controller, the migration and seed packs (migrations run with no
 *  controllers loaded). */
export function completeSystemRow(row: Record<string, unknown>): Record<string, unknown> {
  const kind = row.kind as IdentifierKind
  if (!IDENTIFIER_KINDS.includes(kind)) return row
  const key = String(row.row_id ?? '')
  const variant = row.normalise === 'indian-mobile' || /phone|mobile/.test(key) ? 'phone' : 'email'
  const preset = kindPreset(kind, kind === 'contact' ? variant : null)
  const out: Record<string, unknown> = { ...row }
  for (const [field, value] of Object.entries(preset)) {
    if (field === 'kind') continue
    if (out[field] === undefined || out[field] === null || out[field] === '') out[field] = value
  }
  if (out.enabled === undefined || out.enabled === null) out.enabled = true
  const sensitivity = out.sensitivity as Sensitivity
  if (SENSITIVITY[sensitivity]) Object.assign(out, SENSITIVITY[sensitivity])
  return out
}

/** Assurance is derived from the kind, never stored (D2): only a national ID
 *  is strong evidence that two records are one person. */
export function assuranceOf(kind: IdentifierKind): 'strong' | 'weak' {
  return kind === 'national-id' ? 'strong' : 'weak'
}

// ------------------------------------------------------------ normalising

// Verhoeff (dihedral group D5), the check digit Aadhaar carries.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let c = 0
  const reversed = digits.split('').reverse()
  for (let i = 0; i < reversed.length; i++) c = D[c][P[i % 8][Number(reversed[i])]]
  return c === 0
}

/** The format errors never echo the value (D3): they say what is wrong. */
function invalid(message: string): never {
  throw new AppError('ValidationError', message, { value: 'invalid_format' })
}

/** Tidy a typed value by the system's rule. A national ID must be 12 digits
 *  with a valid Verhoeff check digit. */
export function normaliseValue(raw: unknown, rule: NormaliseRule, kind?: IdentifierKind): string {
  const text = String(raw ?? '').trim()
  if (!text) invalid('A value is required')
  let out: string
  switch (rule) {
    case 'none':
      out = String(raw)
      break
    case 'trim':
      out = text
      break
    case 'upper':
      out = text.toUpperCase()
      break
    case 'lower':
      out = text.toLowerCase()
      break
    case 'digits':
      out = text.replace(/[\s-]/g, '')
      if (!/^\d+$/.test(out)) invalid('Digits only')
      break
    case 'indian-mobile': {
      let d = text.replace(/[\s()-]/g, '')
      if (d.startsWith('+91')) d = d.slice(3)
      else if (d.startsWith('0091')) d = d.slice(4)
      else if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
      else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
      if (!/^[6-9]\d{9}$/.test(d)) invalid('An Indian mobile number has 10 digits starting 6–9')
      out = `+91${d}`
      break
    }
  }
  if (kind === 'national-id' && !(out.length === 12 && verhoeffValid(out)))
    invalid('A national ID is 12 digits with a valid check digit')
  return out
}

/** What a reader sees of a value (D3): the value for Normal and Restricted
 *  (restricted only to restricted readers), nothing for Restricted-hidden
 *  in panels, the hint for Secret, never a fingerprint. */
export function displayValue(
  row: { value: string | null; value_hint: string | null },
  sensitivity: Sensitivity,
  canReadRestricted: boolean,
): { shown: boolean; value: string | null } {
  const s = SENSITIVITY[sensitivity]
  if (s.tier === 'restricted' && !canReadRestricted) return { shown: false, value: null }
  if (s.display === 'hidden') return { shown: false, value: null }
  if (s.display === 'last4') return { shown: true, value: row.value_hint ? `•••• ${row.value_hint}` : null }
  return { shown: true, value: row.value }
}
