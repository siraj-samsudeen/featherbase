import { AppError } from './errors'
import { getMeta } from './meta'
import { isServiceAccountId } from './opaque-id'

// #1010: a permission refusal is read by whoever was refused, so it speaks to
// them ("you") and names the Table by its label. It never shows a principal id
// or an internal Table name the reader can't act on. A service account's
// refusal is also read by the admin who looks at its failed job, so it says
// "this service account" instead of "you".
export async function tableWords(table: string): Promise<string> {
  try {
    return (await getMeta(table)).label?.trim() || table
  } catch {
    return table
  }
}

export function refusalSubject(principal: string): string {
  return isServiceAccountId(principal) ? "This service account doesn't" : "You don't"
}

/** `You don't have read permission on Task discussion.` */
export async function permissionRefusal(principal: string, table: string, action: string): Promise<AppError> {
  return new AppError('PermissionError', `${refusalSubject(principal)} have ${action} permission on ${await tableWords(table)}.`)
}
