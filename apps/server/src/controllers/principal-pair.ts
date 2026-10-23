import type { Hook } from '../controllers'
import { AppError } from '../errors'

// person-rename R2: a Data Scope or Share row belongs to exactly one
// principal — a Person or a Service Account. The database holds the rule
// (`*_one_principal`); this turns a breach into a field error on the form.
export const exactlyOnePrincipal: Hook = ({ row, old }) => {
  const value = (k: string) => {
    const v = k in row ? row[k] : old?.[k]
    return v == null || v === '' ? null : String(v)
  }
  const person = value('person')
  const service = value('service_account')
  if ((person === null) === (service === null))
    throw new AppError('ValidationError', 'Choose a person or a service account — exactly one', {
      person: person ? 'only one of the two' : 'choose a person or a service account',
      service_account: service ? 'only one of the two' : 'choose a person or a service account',
    })
}
