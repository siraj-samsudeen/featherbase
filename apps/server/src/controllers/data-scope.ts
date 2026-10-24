import type { TableController } from '../controllers'
import { exactlyOnePrincipal } from './principal-pair'

// person-rename R2: exactly one of person / service_account.
const controller: TableController = { table: 'Data Scope', hooks: { before_validate: exactlyOnePrincipal } }

export default controller
