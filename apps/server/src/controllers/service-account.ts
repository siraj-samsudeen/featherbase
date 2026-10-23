import type { TableController } from '../controllers'
import { AppError } from '../errors'

// person-rename R2: Service Account is a Table so Reference pickers and forms
// work generically, but every write goes through the service-account API
// (src/service-accounts.ts). A permission gate alone would not hold — System
// Managers bypass permissions — so the generic path is refused here.
const refuse = () => {
  throw new AppError('ValidationError', 'Service accounts are managed by the service-account API (/api/service_accounts)')
}

const controller: TableController = {
  table: 'Service Account',
  hooks: { before_validate: refuse, before_save: refuse, on_trash: refuse },
}

export default controller
